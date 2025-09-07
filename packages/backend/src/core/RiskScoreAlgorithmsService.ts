/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { bindThis } from '@/decorators.js';

export interface TimeSeriesData {
	timestamp: Date;
	value: number;
}

export interface UserBehaviorVector {
	dimensions: number[];
	userId: string;
	timestamp: Date;
}

export interface AnomalyScore {
	score: number;
	isAnomaly: boolean;
	confidence: number;
	details: string[];
}

export interface GraphMetrics {
	pageRank: number;
	clusteringCoefficient: number;
	betweennessCentrality: number;
	communityId: number;
	influenceScore: number;
}

@Injectable()
export class RiskScoreAlgorithmsService {

	@bindThis
	public isolationForest(
		data: number[][],
		targetVector: number[],
		numTrees: number = 100,
		sampleSize: number = 256
	): AnomalyScore {
		const trees: any[] = [];

		for (let i = 0; i < numTrees; i++) {
			const sample = this.randomSample(data, Math.min(sampleSize, data.length));
			const tree = this.buildIsolationTree(sample, 0, Math.ceil(Math.log2(sampleSize)));
			trees.push(tree);
		}

		const pathLengths = trees.map(tree => this.pathLength(tree, targetVector, 0));
		const avgPathLength = pathLengths.reduce((a, b) => a + b, 0) / pathLengths.length;

		const c = this.averagePathLength(data.length);
		const anomalyScore = Math.pow(2, -avgPathLength / c);

		return {
			score: anomalyScore,
			isAnomaly: anomalyScore > 0.65,
			confidence: Math.min(0.95, Math.abs(anomalyScore - 0.5) * 2),
			details: [
				`Average path length: ${avgPathLength.toFixed(2)}`,
				`Anomaly score: ${anomalyScore.toFixed(3)}`,
				`Detected ${anomalyScore > 0.65 ? 'abnormal' : 'normal'} behavior`
			],
		};
	}

	@bindThis
	public localOutlierFactor(
		data: number[][],
		targetVector: number[],
		k: number = 20
	): number {
		const distances = data.map(point => ({
			point,
			distance: this.euclideanDistance(targetVector, point),
		})).sort((a, b) => a.distance - b.distance);

		const kNeighbors = distances.slice(0, k);

		const lrd = this.localReachabilityDensity(targetVector, kNeighbors, data, k);

		const neighborLRDs = kNeighbors.map(neighbor =>
			this.localReachabilityDensity(neighbor.point,
				this.getKNeighbors(neighbor.point, data, k), data, k)
		);

		const avgNeighborLRD = neighborLRDs.reduce((a, b) => a + b, 0) / neighborLRDs.length;
		return avgNeighborLRD / lrd;
	}

	@bindThis
	public timeSeriesAnomalyDetection(
		series: TimeSeriesData[],
		alpha: number = 0.3,
		threshold: number = 3
	): AnomalyScore[] {
		if (series.length < 2) return [];

		const values = series.map(d => d.value);
		const ewma = this.calculateEWMA(values, alpha);
		const residuals = values.map((v, i) => v - ewma[i]);
		const mad = this.medianAbsoluteDeviation(residuals);

		return series.map((data, i) => {
			const deviation = Math.abs(residuals[i]) / (mad * 1.4826);
			const isAnomaly = deviation > threshold;

			return {
				score: Math.min(1, deviation / threshold),
				isAnomaly,
				confidence: Math.min(0.99, deviation / (threshold * 2)),
				details: [
					`Time: ${data.timestamp.toISOString()}`,
					`Value: ${data.value}`,
					`Expected: ${ewma[i].toFixed(2)}`,
					`Deviation: ${deviation.toFixed(2)}σ`
				],
			};
		});
	}

	@bindThis
	public calculateEntropy(data: number[]): number {
		const counts = new Map<number, number>();
		data.forEach(val => counts.set(val, (counts.get(val) || 0) + 1));

		let entropy = 0;
		const total = data.length;

		for (const count of counts.values()) {
			const p = count / total;
			if (p > 0) {
				entropy -= p * Math.log2(p);
			}
		}

		return entropy;
	}

	@bindThis
	public markovChainAnalysis(
		sequences: string[][],
		targetSequence: string[]
	): { probability: number; isUnusual: boolean } {
		const transitions = new Map<string, Map<string, number>>();

		sequences.forEach(seq => {
			for (let i = 0; i < seq.length - 1; i++) {
				const from = seq[i];
				const to = seq[i + 1];

				if (!transitions.has(from)) {
					transitions.set(from, new Map());
				}
				const fromMap = transitions.get(from)!;
				fromMap.set(to, (fromMap.get(to) || 0) + 1);
			}
		});

		for (const [from, toMap] of transitions) {
			const total = Array.from(toMap.values()).reduce((a, b) => a + b, 0);
			for (const [to, count] of toMap) {
				toMap.set(to, count / total);
			}
		}

		let probability = 1;
		for (let i = 0; i < targetSequence.length - 1; i++) {
			const from = targetSequence[i];
			const to = targetSequence[i + 1];

			const transitionProb = transitions.get(from)?.get(to) || 0.001;
			probability *= transitionProb;
		}

		let totalProb = 0;
		let count = 0;
		for (const toMap of transitions.values()) {
			for (const prob of toMap.values()) {
				totalProb += prob;
				count++;
			}
		}
		const avgProb = totalProb / count;
		const expectedProb = Math.pow(avgProb, targetSequence.length - 1);

		return {
			probability,
			isUnusual: probability < expectedProb * 0.1,
		};
	}

	@bindThis
	public dbscan(
		data: number[][],
		eps: number = 0.5,
		minPts: number = 5
	): { clusters: number[]; outliers: number[] } {
		const n = data.length;
		const clusters = new Array(n).fill(-1);
		let clusterId = 0;

		for (let i = 0; i < n; i++) {
			if (clusters[i] !== -1) continue;

			const neighbors = this.rangeQuery(data, i, eps);

			if (neighbors.length < minPts) {
				clusters[i] = -2;
				continue;
			}

			clusters[i] = clusterId;
			const seeds = [...neighbors];

			while (seeds.length > 0) {
				const current = seeds.shift()!;

				if (clusters[current] === -2) {
					clusters[current] = clusterId;
				}

				if (clusters[current] !== -1) continue;

				clusters[current] = clusterId;
				const currentNeighbors = this.rangeQuery(data, current, eps);

				if (currentNeighbors.length >= minPts) {
					seeds.push(...currentNeighbors);
				}
			}

			clusterId++;
		}

		const outliers = clusters.map((c, i) => c === -2 ? i : -1).filter(i => i !== -1);

		return { clusters, outliers };
	}

	@bindThis
	public bayesianRiskScore(
		features: Record<string, number>,
		historicalData: Array<{ features: Record<string, number>; isRisky: boolean }>
	): { riskProbability: number; confidence: number } {
		const riskyCount = historicalData.filter(d => d.isRisky).length;
		const priorRisk = riskyCount / historicalData.length;
		const priorSafe = 1 - priorRisk;

		let likelihoodRisk = 1;
		let likelihoodSafe = 1;

		for (const [feature, value] of Object.entries(features)) {
			const riskyValues = historicalData
				.filter(d => d.isRisky)
				.map(d => d.features[feature] || 0);
			const safeValues = historicalData
				.filter(d => !d.isRisky)
				.map(d => d.features[feature] || 0);

			const riskyMean = this.mean(riskyValues);
			const riskyStd = this.standardDeviation(riskyValues);
			const safeMean = this.mean(safeValues);
			const safeStd = this.standardDeviation(safeValues);

			likelihoodRisk *= this.gaussianPDF(value, riskyMean, riskyStd);
			likelihoodSafe *= this.gaussianPDF(value, safeMean, safeStd);
		}

		const posteriorRisk = (likelihoodRisk * priorRisk) /
			(likelihoodRisk * priorRisk + likelihoodSafe * priorSafe);

		const dataConfidence = Math.min(1, historicalData.length / 100);
		const separationConfidence = Math.abs(posteriorRisk - 0.5) * 2;
		const confidence = (dataConfidence + separationConfidence) / 2;

		return {
			riskProbability: posteriorRisk,
			confidence,
		};
	}

	@bindThis
	public randomForestScore(
		features: number[],
		trees: Array<DecisionTree>,
		numTrees: number = 100
	): number {
		const predictions = trees.slice(0, numTrees).map(tree =>
			this.predictTree(tree, features)
		);

		return predictions.reduce((a, b) => a + b, 0) / predictions.length;
	}

	@bindThis
	public pageRank(
		adjacencyMatrix: number[][],
		damping: number = 0.85,
		iterations: number = 100
	): number[] {
		const n = adjacencyMatrix.length;
		let ranks = new Array(n).fill(1 / n);

		for (let iter = 0; iter < iterations; iter++) {
			const newRanks = new Array(n).fill((1 - damping) / n);

			for (let i = 0; i < n; i++) {
				const outDegree = adjacencyMatrix[i].reduce((a, b) => a + b, 0);
				if (outDegree > 0) {
					for (let j = 0; j < n; j++) {
						if (adjacencyMatrix[i][j] > 0) {
							newRanks[j] += damping * ranks[i] / outDegree;
						}
					}
				}
			}

			ranks = newRanks;
		}

		return ranks;
	}

	@bindThis
	public communityDetection(
		adjacencyMatrix: number[][]
	): number[] {
		const n = adjacencyMatrix.length;
		const communities = Array.from({ length: n }, (_, i) => i);

		let improved = true;
		while (improved) {
			improved = false;

			for (let node = 0; node < n; node++) {
				const currentCommunity = communities[node];
				let bestCommunity = currentCommunity;
				let bestGain = 0;

				for (let neighbor = 0; neighbor < n; neighbor++) {
					if (adjacencyMatrix[node][neighbor] > 0 && communities[neighbor] !== currentCommunity) {
						const gain = this.modularityGain(adjacencyMatrix, communities, node, communities[neighbor]);
						if (gain > bestGain) {
							bestGain = gain;
							bestCommunity = communities[neighbor];
						}
					}
				}

				if (bestCommunity !== currentCommunity) {
					communities[node] = bestCommunity;
					improved = true;
				}
			}
		}

		return communities;
	}

	@bindThis
	public sequenceSimilarity(seq1: string[], seq2: string[]): number {
		const m = seq1.length;
		const n = seq2.length;
		const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

		for (let i = 0; i <= m; i++) dp[i][0] = i;
		for (let j = 0; j <= n; j++) dp[0][j] = j;

		for (let i = 1; i <= m; i++) {
			for (let j = 1; j <= n; j++) {
				if (seq1[i - 1] === seq2[j - 1]) {
					dp[i][j] = dp[i - 1][j - 1];
				} else {
					dp[i][j] = Math.min(
						dp[i - 1][j] + 1,
						dp[i][j - 1] + 1,
						dp[i - 1][j - 1] + 1
					);
				}
			}
		}

		const maxLen = Math.max(m, n);
		return 1 - (dp[m][n] / maxLen);
	}

	private buildIsolationTree(data: number[][], depth: number, maxDepth: number): any {
		if (depth >= maxDepth || data.length <= 1) {
			return { isLeaf: true, size: data.length };
		}

		const dim = Math.floor(Math.random() * data[0].length);
		const values = data.map(d => d[dim]);
		const min = Math.min(...values);
		const max = Math.max(...values);

		if (min === max) {
			return { isLeaf: true, size: data.length };
		}

		const split = min + Math.random() * (max - min);
		const left = data.filter(d => d[dim] < split);
		const right = data.filter(d => d[dim] >= split);

		return {
			isLeaf: false,
			dim,
			split,
			left: this.buildIsolationTree(left, depth + 1, maxDepth),
			right: this.buildIsolationTree(right, depth + 1, maxDepth),
		};
	}

	private pathLength(tree: any, point: number[], depth: number): number {
		if (tree.isLeaf) {
			return depth + this.averagePathLength(tree.size);
		}

		if (point[tree.dim] < tree.split) {
			return this.pathLength(tree.left, point, depth + 1);
		} else {
			return this.pathLength(tree.right, point, depth + 1);
		}
	}

	private averagePathLength(n: number): number {
		if (n <= 1) return 0;
		if (n === 2) return 1;
		return 2 * (Math.log(n - 1) + 0.5772156649) - (2 * (n - 1) / n);
	}

	private euclideanDistance(a: number[], b: number[]): number {
		return Math.sqrt(a.reduce((sum, val, i) => sum + Math.pow(val - b[i], 2), 0));
	}

	private randomSample<T>(array: T[], size: number): T[] {
		const shuffled = [...array].sort(() => Math.random() - 0.5);
		return shuffled.slice(0, size);
	}

	private localReachabilityDensity(
		point: number[],
		neighbors: any[],
		data: number[][],
		k: number
	): number {
		const reachDists = neighbors.map(n =>
			Math.max(n.distance, this.kDistance(n.point, data, k))
		);
		const avgReachDist = reachDists.reduce((a, b) => a + b, 0) / reachDists.length;
		return 1 / avgReachDist;
	}

	private kDistance(point: number[], data: number[][], k: number): number {
		const distances = data.map(p => this.euclideanDistance(point, p)).sort((a, b) => a - b);
		return distances[k - 1] || 0;
	}

	private getKNeighbors(point: number[], data: number[][], k: number): any[] {
		return data.map(p => ({
			point: p,
			distance: this.euclideanDistance(point, p),
		})).sort((a, b) => a.distance - b.distance).slice(0, k);
	}

	private calculateEWMA(values: number[], alpha: number): number[] {
		const ewma: number[] = [values[0]];
		for (let i = 1; i < values.length; i++) {
			ewma.push(alpha * values[i] + (1 - alpha) * ewma[i - 1]);
		}
		return ewma;
	}

	private medianAbsoluteDeviation(values: number[]): number {
		const median = this.median(values);
		const absoluteDeviations = values.map(v => Math.abs(v - median));
		return this.median(absoluteDeviations);
	}

	private median(values: number[]): number {
		const sorted = [...values].sort((a, b) => a - b);
		const mid = Math.floor(sorted.length / 2);
		return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
	}

	private mean(values: number[]): number {
		return values.reduce((a, b) => a + b, 0) / values.length;
	}

	private standardDeviation(values: number[]): number {
		const avg = this.mean(values);
		const squaredDiffs = values.map(v => Math.pow(v - avg, 2));
		return Math.sqrt(this.mean(squaredDiffs));
	}

	private gaussianPDF(x: number, mean: number, std: number): number {
		const variance = std * std;
		return Math.exp(-Math.pow(x - mean, 2) / (2 * variance)) /
			Math.sqrt(2 * Math.PI * variance);
	}

	private rangeQuery(data: number[][], pointIdx: number, eps: number): number[] {
		const neighbors: number[] = [];
		const point = data[pointIdx];

		for (let i = 0; i < data.length; i++) {
			if (i !== pointIdx && this.euclideanDistance(point, data[i]) <= eps) {
				neighbors.push(i);
			}
		}

		return neighbors;
	}

	private modularityGain(
		adjacencyMatrix: number[][],
		communities: number[],
		node: number,
		targetCommunity: number
	): number {
		let gain = 0;
		for (let i = 0; i < adjacencyMatrix.length; i++) {
			if (communities[i] === targetCommunity) {
				gain += adjacencyMatrix[node][i];
			}
			if (communities[i] === communities[node] && i !== node) {
				gain -= adjacencyMatrix[node][i];
			}
		}
		return gain;
	}

	private predictTree(tree: DecisionTree, features: number[]): number {
		if (tree.isLeaf) {
			return tree.value ?? 0;
		}

		if (tree.featureIndex !== undefined && tree.threshold !== undefined) {
			if (features[tree.featureIndex] <= tree.threshold) {
				return tree.left ? this.predictTree(tree.left, features) : 0;
			} else {
				return tree.right ? this.predictTree(tree.right, features) : 0;
			}
		}

		return 0;
	}
}

interface DecisionTree {
	isLeaf: boolean;
	value?: number;
	featureIndex?: number;
	threshold?: number;
	left?: DecisionTree;
	right?: DecisionTree;
}
