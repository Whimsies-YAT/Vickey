/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import crypto from 'crypto';
import * as fs from 'fs';
import { Inject, Injectable, OnModuleInit, OnApplicationShutdown } from '@nestjs/common';
import * as Redis from 'ioredis';
import { type DataSource, type Repository, In } from 'typeorm';
import cld from 'cld';
import keywordExtractor from 'keyword-extractor';
import { bindThis } from '@/decorators.js';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type { MiNote } from '@/models/Note.js';
import { MiContentEmbedding } from '@/models/ContentEmbedding.js';
import { MiUserInterestEmbedding } from '@/models/UserInterestEmbedding.js';
import { MiEmbeddingBatchQueue } from '@/models/EmbeddingBatchQueue.js';
import { IdService } from '@/core/IdService.js';

type ContentAnalysisResult = {
	confidence: number;
	embedding?: number[];
	features: {
		sentiment: {
			score: number;
			confidence: number;
			label: 'positive' | 'negative' | 'neutral';
		};
		topics: {
			topics: Array<{ name: string; confidence: number }>;
			primaryTopic: string;
		};
		quality: {
			readabilityScore: number;
			coherenceScore: number;
			lengthScore: number;
		};
		safety: {
			toxicityScore: number;
			spamScore: number;
			isSafe: boolean;
		};
	};
};

type EmbeddingBatch = {
	id: string;
	text: string;
	hash: string;
};

@Injectable()
export class LocalAIContentAnalysisService implements OnModuleInit, OnApplicationShutdown {
	private readonly isEnabled: boolean;
	private readonly multiLangSentimentWords: Map<string, Map<string, number>> = new Map();
	private readonly multiLangTopicKeywords: Map<string, Map<string, string[]>> = new Map();
	private embeddingModel: any = null;
	private isModelLoaded = false;
	private batchProcessor: NodeJS.Timeout | null = null;
	private persistenceScheduler: NodeJS.Timeout | null = null;
	private isPersisting = false;
	private readonly batchSize = 32;
	private readonly maxBatchWaitTime = 5000;
	private readonly persistenceInterval = 300000;
	private contentEmbeddingRepository: Repository<MiContentEmbedding>;
	private userInterestEmbeddingRepository: Repository<MiUserInterestEmbedding>;
	private embeddingBatchQueueRepository: Repository<MiEmbeddingBatchQueue>;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.db)
		private db: DataSource,

		private idService: IdService,
	) {
		this.isEnabled = this.config.enableLocalAIContentAnalysis;
		this.contentEmbeddingRepository = this.db.getRepository(MiContentEmbedding);
		this.userInterestEmbeddingRepository = this.db.getRepository(MiUserInterestEmbedding);
		this.embeddingBatchQueueRepository = this.db.getRepository(MiEmbeddingBatchQueue);

		if (this.isEnabled) {
			this.initializeMultiLangDictionaries();
		}
	}

	async onModuleInit(): Promise<void> {
		if (this.isEnabled) {
			await this.initializeEmbeddingModel();
			this.startBatchProcessor();
			this.startPersistenceScheduler();
		}
	}

	async onApplicationShutdown(): Promise<void> {
		if (this.batchProcessor) {
			clearInterval(this.batchProcessor);
		}
		if (this.persistenceScheduler) {
			clearInterval(this.persistenceScheduler);
		}
		await this.persistAllPendingEmbeddings();
	}

	public isFeatureEnabled(): boolean {
		return this.isEnabled;
	}

	@bindThis
	public async analyzeContentWithStrategy(note: MiNote, isLocal = true): Promise<ContentAnalysisResult | null> {
		if (!this.isEnabled) {
			return null;
		}

		try {
			if (!isLocal) {
				return await this.analyzeExternalContent(note);
			}
			return await this.analyzeContent(note);
		} catch (error) {
			console.error('Error in content analysis:', error);
			return null;
		}
	}

	@bindThis
	public async analyzeContentBatch(notes: MiNote[]): Promise<Map<string, ContentAnalysisResult | null>> {
		if (!this.isEnabled) {
			return new Map();
		}

		try {
			const results = new Map<string, ContentAnalysisResult | null>();
			const batches: EmbeddingBatch[] = [];

			for (const note of notes) {
				const text = this.extractTextFromNote(note);
				const hash = this.getContentHash(text);
				batches.push({ id: note.id, text, hash });
			}

			const embeddings = await this.getOrCreateEmbeddingsBatch(batches);

			for (const note of notes) {
				const text = this.extractTextFromNote(note);
				const hash = this.getContentHash(text);
				const embedding = embeddings.get(hash);

				const analysis = await this.analyzeWithEmbedding(note, embedding);
				results.set(note.id, analysis);
			}

			return results;
		} catch (error) {
			console.error('Error in batch content analysis:', error);
			return new Map();
		}
	}

	@bindThis
	public async getUserSimilarContent(userId: string, candidateNotes: MiNote[], topK = 20): Promise<MiNote[]> {
		if (!this.isEnabled || !this.isModelLoaded) {
			return candidateNotes.slice(0, topK);
		}

		try {
			const userEmbedding = await this.getUserInterestEmbedding(userId);
			if (!userEmbedding) {
				return candidateNotes.slice(0, topK);
			}

			const noteScores: Array<{ note: MiNote; score: number }> = [];

			for (const note of candidateNotes) {
				const text = this.extractTextFromNote(note);
				const hash = this.getContentHash(text);
				const contentEmbedding = await this.getOrCreateEmbedding(text, hash);

				if (contentEmbedding) {
					const similarity = this.calculateCosineSimilarity(userEmbedding.embedding, contentEmbedding);
					noteScores.push({ note, score: similarity });
				} else {
					noteScores.push({ note, score: 0.1 });
				}
			}

			noteScores.sort((a, b) => b.score - a.score);
			return noteScores.slice(0, topK).map(item => item.note);
		} catch (error) {
			console.error('Error in content similarity search:', error);
			return candidateNotes.slice(0, topK);
		}
	}

	@bindThis
	public async updateUserInterestEmbedding(userId: string, interactedNotes: MiNote[]): Promise<void> {
		if (!this.isEnabled || !this.isModelLoaded || interactedNotes.length === 0) {
			return;
		}

		try {
			const embeddings: number[][] = [];

			for (const note of interactedNotes) {
				const text = this.extractTextFromNote(note);
				const hash = this.getContentHash(text);
				const embedding = await this.getOrCreateEmbedding(text, hash);
				if (embedding) {
					embeddings.push(embedding);
				}
			}

			if (embeddings.length === 0) return;

			const avgEmbedding = this.calculateAverageEmbedding(embeddings);

			let userInterest = await this.userInterestEmbeddingRepository.findOne({
				where: { userId, modelVersion: 'distiluse-v1' },
			});

			if (userInterest) {
				const decayFactor = 0.9;
				const newWeight = 0.1;

				for (let i = 0; i < userInterest.embedding.length; i++) {
					userInterest.embedding[i] = decayFactor * userInterest.embedding[i] + newWeight * avgEmbedding[i];
				}

				userInterest.interactionCount += interactedNotes.length;
				userInterest.lastUpdate = new Date();
			} else {
				userInterest = this.userInterestEmbeddingRepository.create({
					id: this.idService.gen(),
					userId,
					embedding: avgEmbedding,
					modelVersion: 'distiluse-v1',
					interactionCount: interactedNotes.length,
					lastUpdate: new Date(),
				});
			}

			await this.userInterestEmbeddingRepository.save(userInterest);
		} catch (error) {
			console.error('Error updating user interest embedding:', error);
		}
	}

	@bindThis
	public getContentScore(analysis: ContentAnalysisResult): number {
		const features = analysis.features;
		const weights = {
			sentiment: 0.25,
			quality: 0.25,
			safety: 0.3,
			topics: 0.2,
		};

		const sentimentScore = this.normalizeSentimentScore(features.sentiment.score);
		const qualityScore = (features.quality.readabilityScore + features.quality.coherenceScore + features.quality.lengthScore) / 3;
		const safetyScore = features.safety.isSafe ? (1 - features.safety.toxicityScore - features.safety.spamScore) : 0.1;
		const topicScore = features.topics.topics.reduce((sum, topic) => sum + topic.confidence, 0) / features.topics.topics.length;

		return Math.max(0.1, Math.min(1.0,
			sentimentScore * weights.sentiment +
			qualityScore * weights.quality +
			safetyScore * weights.safety +
			topicScore * weights.topics,
		));
	}

	@bindThis
	private async initializeEmbeddingModel(): Promise<void> {
		try {
			console.log('Initializing CPU-optimized embedding model...');

			const modelCacheDir = '../../files/models-cache';

			if (!fs.existsSync(modelCacheDir)) {
				fs.mkdirSync(modelCacheDir, { recursive: true });
				console.log(`Created model cache directory: ${modelCacheDir}`);
			}

			const { pipeline, env } = await import('@xenova/transformers');
			const os = await import('os');

			env.cacheDir = modelCacheDir;
			env.allowLocalModels = true;
			env.allowRemoteModels = true;
			env.backends.onnx.wasm.numThreads = Math.min(4, os.cpus().length);

			env.useBrowserCache = false;
			env.useFS = true;

			console.log(`Using persistent model cache: ${modelCacheDir}`);

			const modelOptions = [
				'Xenova/all-MiniLM-L6-v2',
				'Xenova/all-MiniLM-L12-v2',
			];

			let modelLoaded = false;
			let lastError: any;

			for (const modelName of modelOptions) {
				try {
					console.log(`Attempting to load model: ${modelName}`);

					this.embeddingModel = await pipeline(
						'feature-extraction',
						modelName,
						{
							quantized: true,
							cache_dir: modelCacheDir,
							local_files_only: false,
						},
					);

					console.log(`Successfully loaded model: ${modelName}`);
					modelLoaded = true;
					break;
				} catch (error) {
					console.warn(`Failed to load model ${modelName}:`, error);
					lastError = error;
					continue;
				}
			}

			if (!modelLoaded) {
				throw lastError || new Error('Failed to load any embedding model');
			}

			this.isModelLoaded = true;
			console.log('CPU-optimized embedding model loaded successfully');
		} catch (error) {
			console.error('Failed to load embedding model:', error);
			this.isModelLoaded = false;
		}
	}

	@bindThis
	private async analyzeContent(note: MiNote): Promise<ContentAnalysisResult> {
		const text = this.extractTextFromNote(note);
		const hash = this.getContentHash(text);

		const embedding = await this.getOrCreateEmbedding(text, hash);
		return await this.analyzeWithEmbedding(note, embedding || undefined);
	}

	@bindThis
	private async analyzeExternalContent(note: MiNote): Promise<ContentAnalysisResult> {
		const text = this.extractTextFromNote(note);
		const language = await this.detectLanguage(text);

		const safety = await this.analyzeSafety(text, language);
		const sentiment = await this.analyzeSentiment(text, language);

		const basicQuality = {
			readabilityScore: Math.min(1.0, text.length / 100),
			coherenceScore: 0.5,
			lengthScore: Math.min(1.0, text.length / 280),
		};

		const basicTopics = {
			topics: [{ name: 'general', confidence: 0.5 }],
			primaryTopic: 'general',
		};

		return {
			confidence: 0.6,
			features: {
				sentiment,
				topics: basicTopics,
				quality: basicQuality,
				safety,
			},
		};
	}

	@bindThis
	private async analyzeWithEmbedding(note: MiNote, embedding?: number[]): Promise<ContentAnalysisResult> {
		const text = this.extractTextFromNote(note);
		const language = await this.detectLanguage(text);

		const sentiment = await this.analyzeSentiment(text, language);
		const topics = embedding ? await this.analyzeTopicsWithEmbedding(text, embedding, language)
			: await this.analyzeTopics(text, language);
		const quality = await this.analyzeQuality(text, language);
		const safety = await this.analyzeSafety(text, language);

		return {
			confidence: embedding ? 0.9 : 0.75,
			embedding,
			features: {
				sentiment,
				topics,
				quality,
				safety,
			},
		};
	}

	@bindThis
	private async getOrCreateEmbedding(text: string, hash: string): Promise<number[] | null> {
		try {
			const cacheKey = `embedding:${hash}`;
			const cached = await this.redisClient.get(cacheKey);
			if (cached) {
				try {
					return JSON.parse(cached);
				} catch (error) {
					await this.redisClient.del(cacheKey);
				}
			}

			const dbCached = await this.contentEmbeddingRepository.findOne({
				where: { contentHash: hash, modelVersion: 'distiluse-v1' },
			});

			if (dbCached) {
				await this.redisClient.setex(cacheKey, 7200, JSON.stringify(dbCached.embedding));
				return dbCached.embedding;
			}

			if (!this.isModelLoaded) {
				return null;
			}

			const embedding = await this.generateEmbedding(text);
			if (!embedding) return null;

			await this.redisClient.setex(cacheKey, 7200, JSON.stringify(embedding));

			await this.markEmbeddingForPersistence(hash, embedding);

			return embedding;
		} catch (error) {
			console.error('Error getting or creating embedding:', error);
			return null;
		}
	}

	@bindThis
	private async getOrCreateEmbeddingsBatch(batches: EmbeddingBatch[]): Promise<Map<string, number[]>> {
		const results = new Map<string, number[]>();
		const toGenerate: EmbeddingBatch[] = [];

		for (const batch of batches) {
			const cacheKey = `embedding:${batch.hash}`;
			const cached = await this.redisClient.get(cacheKey);
			if (cached) {
				try {
					results.set(batch.hash, JSON.parse(cached));
					continue;
				} catch (error) {
					await this.redisClient.del(cacheKey);
				}
			}

			const dbCached = await this.contentEmbeddingRepository.findOne({
				where: { contentHash: batch.hash, modelVersion: 'distiluse-v1' },
			});

			if (dbCached) {
				await this.redisClient.setex(cacheKey, 7200, JSON.stringify(dbCached.embedding));
				results.set(batch.hash, dbCached.embedding);
			} else {
				toGenerate.push(batch);
			}
		}

		if (toGenerate.length > 0 && this.isModelLoaded) {
			const texts = toGenerate.map(b => b.text);
			const embeddings = await this.generateEmbeddingsBatch(texts);

			for (let i = 0; i < toGenerate.length; i++) {
				const batch = toGenerate[i];
				const embedding = embeddings[i];

				if (embedding) {
					results.set(batch.hash, embedding);

					const cacheKey = `embedding:${batch.hash}`;
					await this.redisClient.setex(cacheKey, 7200, JSON.stringify(embedding));

					await this.markEmbeddingForPersistence(batch.hash, embedding);
				}
			}
		}

		return results;
	}

	@bindThis
	private async generateEmbedding(text: string): Promise<number[] | null> {
		try {
			if (!this.isModelLoaded || !this.embeddingModel) {
				return null;
			}

			const result = await this.embeddingModel(text, { pooling: 'mean', normalize: true });
			return Array.from(result.data);
		} catch (error) {
			console.error('Error generating embedding:', error);
			return null;
		}
	}

	@bindThis
	private async generateEmbeddingsBatch(texts: string[]): Promise<(number[] | null)[]> {
		try {
			if (!this.isModelLoaded || !this.embeddingModel) {
				return texts.map(() => null);
			}

			const results = await this.embeddingModel(texts, { pooling: 'mean', normalize: true });
			return results.tolist();
		} catch (error) {
			console.error('Error generating batch embeddings:', error);
			return texts.map(() => null);
		}
	}

	@bindThis
	private async getUserInterestEmbedding(userId: string): Promise<MiUserInterestEmbedding | null> {
		try {
			return await this.userInterestEmbeddingRepository.findOne({
				where: { userId, modelVersion: 'distiluse-v1' },
			});
		} catch (error) {
			console.error('Error getting user interest embedding:', error);
			return null;
		}
	}

	@bindThis
	private calculateCosineSimilarity(vecA: number[], vecB: number[]): number {
		if (vecA.length !== vecB.length) return 0;

		let dotProduct = 0;
		let normA = 0;
		let normB = 0;

		for (let i = 0; i < vecA.length; i++) {
			dotProduct += vecA[i] * vecB[i];
			normA += vecA[i] * vecA[i];
			normB += vecB[i] * vecB[i];
		}

		normA = Math.sqrt(normA);
		normB = Math.sqrt(normB);

		if (normA === 0 || normB === 0) return 0;
		return dotProduct / (normA * normB);
	}

	@bindThis
	private calculateAverageEmbedding(embeddings: number[][]): number[] {
		if (embeddings.length === 0) return [];

		const avgEmbedding = new Array(embeddings[0].length).fill(0);

		for (const embedding of embeddings) {
			for (let i = 0; i < embedding.length; i++) {
				avgEmbedding[i] += embedding[i];
			}
		}

		for (let i = 0; i < avgEmbedding.length; i++) {
			avgEmbedding[i] /= embeddings.length;
		}

		return avgEmbedding;
	}

	@bindThis
	private startBatchProcessor(): void {
		this.batchProcessor = setInterval(async () => {
			try {
				const pendingBatches = await this.embeddingBatchQueueRepository.find({
					where: { status: 'pending' },
					order: { priority: 'DESC', createdAt: 'ASC' },
					take: this.batchSize,
				});

				if (pendingBatches.length > 0) {
					await this.processBatchQueue(pendingBatches);
				}
			} catch (error) {
				console.error('Error in batch processor:', error);
			}
		}, this.maxBatchWaitTime);
	}

	@bindThis
	private startPersistenceScheduler(): void {
		this.persistenceScheduler = setInterval(async () => {
			try {
				await this.persistAllPendingEmbeddings();
			} catch (error) {
				console.error('Error in persistence scheduler:', error);
			}
		}, this.persistenceInterval);
	}

	@bindThis
	private async processBatchQueue(batches: MiEmbeddingBatchQueue[]): Promise<void> {
		if (!this.isModelLoaded) return;

		try {
			const batchIds = batches.map(b => b.id);
			await this.embeddingBatchQueueRepository.update(
				batchIds,
				{ status: 'processing' },
			);

			const texts = batches.map(b => b.contentText);
			const embeddings = await this.generateEmbeddingsBatch(texts);

			for (let i = 0; i < batches.length; i++) {
				const batch = batches[i];
				const embedding = embeddings[i];

				if (embedding) {
					const contentEmbedding = this.contentEmbeddingRepository.create({
						id: this.idService.gen(),
						contentHash: batch.contentHash,
						embedding,
						modelVersion: 'distiluse-v1',
					});

					await this.contentEmbeddingRepository.save(contentEmbedding);
					batch.status = 'completed';
				} else {
					batch.status = 'failed';
				}

				batch.processedAt = new Date();
				await this.embeddingBatchQueueRepository.save(batch);
			}
		} catch (error) {
			console.error('Error processing batch queue:', error);
		}
	}

	@bindThis
	private extractTextFromNote(note: MiNote): string {
		let text = note.text || '';
		if (note.cw) text = note.cw + ' ' + text;
		return text.trim();
	}

	@bindThis
	private getContentHash(text: string): string {
		return crypto.createHash('sha256').update(text).digest('hex');
	}

	@bindThis
	private async detectLanguage(text: string): Promise<string> {
		try {
			const result = await cld.detect(text);
			return result.languages[0]?.code || 'en';
		} catch {
			return 'en';
		}
	}

	@bindThis
	private normalizeSentimentScore(score: number): number {
		return (score + 1) / 2;
	}

	@bindThis
	private async analyzeSentiment(text: string, language: string): Promise<{ score: number; confidence: number; label: 'positive' | 'negative' | 'neutral' }> {
		const sentimentWords = this.multiLangSentimentWords.get(language) || this.multiLangSentimentWords.get('en')!;
		const words = text.toLowerCase().split(/\s+/);
		let score = 0;
		let count = 0;

		for (const word of words) {
			if (sentimentWords.has(word)) {
				score += sentimentWords.get(word)!;
				count++;
			}
		}

		const avgScore = count > 0 ? score / count : 0;
		const confidence = Math.min(1.0, count / words.length * 5);

		let label: 'positive' | 'negative' | 'neutral';
		if (avgScore > 0.1) label = 'positive';
		else if (avgScore < -0.1) label = 'negative';
		else label = 'neutral';

		return { score: avgScore, confidence, label };
	}

	@bindThis
	private async analyzeTopics(text: string, language: string): Promise<{ topics: Array<{ name: string; confidence: number }>; primaryTopic: string }> {
		try {
			const keywords = (keywordExtractor as any).extract(text, {
				language: language === 'zh' ? 'chinese' : 'english',
				remove_digits: true,
				return_changed_case: true,
				remove_duplicates: true,
			});

			const topicKeywords = this.multiLangTopicKeywords.get(language) || this.multiLangTopicKeywords.get('en')!;
			const topicScores = new Map<string, number>();

			for (const keyword of keywords) {
				for (const [topic, topicWords] of topicKeywords) {
					if (topicWords.includes(keyword.toLowerCase())) {
						topicScores.set(topic, (topicScores.get(topic) || 0) + 1);
					}
				}
			}

			const topics = Array.from(topicScores.entries())
				.map(([name, count]) => ({ name, confidence: Math.min(1.0, count / keywords.length) }))
				.sort((a, b) => b.confidence - a.confidence)
				.slice(0, 5);

			if (topics.length === 0) {
				topics.push({ name: 'general', confidence: 0.5 });
			}

			return {
				topics,
				primaryTopic: topics[0].name,
			};
		} catch (error) {
			return {
				topics: [{ name: 'general', confidence: 0.5 }],
				primaryTopic: 'general',
			};
		}
	}

	@bindThis
	private async analyzeTopicsWithEmbedding(text: string, embedding: number[], language: string): Promise<{ topics: Array<{ name: string; confidence: number }>; primaryTopic: string }> {
		try {
			const predefinedTopics = [
				{ name: 'technology', keywords: ['tech', 'ai', 'computer', 'software', 'programming'] },
				{ name: 'entertainment', keywords: ['music', 'movie', 'game', 'fun', 'entertainment'] },
				{ name: 'politics', keywords: ['politics', 'government', 'election', 'policy', 'law'] },
				{ name: 'sports', keywords: ['sport', 'football', 'basketball', 'soccer', 'game'] },
				{ name: 'science', keywords: ['science', 'research', 'study', 'discovery', 'theory'] },
				{ name: 'lifestyle', keywords: ['food', 'travel', 'fashion', 'health', 'lifestyle'] },
				{ name: 'business', keywords: ['business', 'market', 'finance', 'economy', 'company'] },
			];

			const topics: Array<{ name: string; confidence: number }> = [];
			const textLower = text.toLowerCase();

			for (const topic of predefinedTopics) {
				let matches = 0;
				for (const keyword of topic.keywords) {
					if (textLower.includes(keyword)) {
						matches++;
					}
				}

				if (matches > 0) {
					const confidence = Math.min(1.0, matches / topic.keywords.length * 2);
					topics.push({ name: topic.name, confidence });
				}
			}

			topics.sort((a, b) => b.confidence - a.confidence);

			if (topics.length === 0) {
				topics.push({ name: 'general', confidence: 0.5 });
			}

			return {
				topics: topics.slice(0, 5),
				primaryTopic: topics[0].name,
			};
		} catch (error) {
			return await this.analyzeTopics(text, language);
		}
	}

	@bindThis
	private async analyzeQuality(text: string, language: string): Promise<{ readabilityScore: number; coherenceScore: number; lengthScore: number }> {
		const length = text.length;
		const words = text.split(/\s+/).length;
		const sentences = text.split(/[.!?]+/).filter(s => s.trim()).length;

		const readabilityScore = Math.min(1.0, sentences > 0 ? words / sentences / 20 : 0);
		const coherenceScore = Math.min(1.0, length > 20 && length < 1000 ? 0.8 : 0.4);
		const lengthScore = Math.min(1.0, length / 280);

		return { readabilityScore, coherenceScore, lengthScore };
	}

	@bindThis
	private async analyzeSafety(text: string, language: string): Promise<{ toxicityScore: number; spamScore: number; isSafe: boolean }> {
		const toxicityScore = text.toLowerCase().includes('hate') ? 0.8 : 0.1;
		const spamScore = text.includes('http') && text.length < 50 ? 0.7 : 0.1;
		const isSafe = toxicityScore < 0.5 && spamScore < 0.5;

		return { toxicityScore, spamScore, isSafe };
	}

	private initializeMultiLangDictionaries(): void {
		const enSentiment = new Map([
			['good', 0.7], ['great', 0.8], ['excellent', 0.9], ['bad', -0.7], ['terrible', -0.8],
			['love', 0.8], ['hate', -0.8], ['happy', 0.7], ['sad', -0.7], ['amazing', 0.9],
		]);
		this.multiLangSentimentWords.set('en', enSentiment);

		const enTopics = new Map([
			['technology', ['tech', 'ai', 'computer', 'software', 'programming', 'code']],
			['entertainment', ['movie', 'music', 'game', 'fun', 'show', 'art']],
			['lifestyle', ['food', 'travel', 'fashion', 'health', 'home', 'style']],
			['news', ['news', 'politics', 'election', 'government', 'economy', 'business']],
		]);
		this.multiLangTopicKeywords.set('en', enTopics);
	}

	@bindThis
	private async markEmbeddingForPersistence(hash: string, embedding: number[]): Promise<void> {
		try {
			const persistKey = `persist_embedding:${hash}`;
			const embeddingData = {
				hash,
				embedding,
				timestamp: Date.now(),
			};

			await this.redisClient.setex(persistKey, 86400, JSON.stringify(embeddingData));
		} catch (error) {
			console.error('Error marking embedding for persistence:', error);
		}
	}

	@bindThis
	private async persistAllPendingEmbeddings(): Promise<void> {
		if (this.isPersisting) return;
		this.isPersisting = true;

		try {
			console.log('LocalAIContentAnalysisService: Persisting all pending embeddings...');

			const persistKeys = await this.redisClient.keys('persist_embedding:*');
			if (persistKeys.length === 0) return;

			const BATCH_SIZE = 50;
			let persistedCount = 0;

			for (let i = 0; i < persistKeys.length; i += BATCH_SIZE) {
				const batchKeys = persistKeys.slice(i, i + BATCH_SIZE);
				const batchValues = await this.redisClient.mget(batchKeys);

				const embeddingsToSave: MiContentEmbedding[] = [];
				const hashesToCheck: string[] = [];
				const keysToDelete: string[] = [];
				const embeddingDataMap = new Map<string, { hash: string; embedding: number[] }>();

				for (let j = 0; j < batchKeys.length; j++) {
					const val = batchValues[j];
					if (val) {
						try {
							const data = JSON.parse(val);
							embeddingDataMap.set(data.hash, data);
							hashesToCheck.push(data.hash);
							keysToDelete.push(batchKeys[j]);
						} catch (e) {
							keysToDelete.push(batchKeys[j]);
						}
					} else {
						keysToDelete.push(batchKeys[j]);
					}
				}

				if (hashesToCheck.length > 0) {
					const existing = await this.contentEmbeddingRepository.find({
						where: {
							contentHash: In(hashesToCheck),
							modelVersion: 'distiluse-v1',
						},
					});

					const existingHashes = new Set(existing.map(e => e.contentHash));

					for (const hash of hashesToCheck) {
						if (!existingHashes.has(hash)) {
							const data = embeddingDataMap.get(hash);
							if (data) {
								embeddingsToSave.push(this.contentEmbeddingRepository.create({
									id: this.idService.gen(),
									contentHash: data.hash,
									embedding: data.embedding,
									modelVersion: 'distiluse-v1',
								}));
							}
						}
					}

					if (embeddingsToSave.length > 0) {
						await this.contentEmbeddingRepository.save(embeddingsToSave);
						persistedCount += embeddingsToSave.length;
					}
				}

				if (keysToDelete.length > 0) {
					await this.redisClient.del(...keysToDelete);
				}
			}

			if (persistedCount > 0) {
				console.log(`LocalAIContentAnalysisService: Persisted ${persistedCount} embeddings to database`);
			}
		} catch (error) {
			console.error('LocalAIContentAnalysisService: Error persisting embeddings:', error);
		} finally {
			this.isPersisting = false;
		}
	}
}
