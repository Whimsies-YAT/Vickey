import { PrimaryColumn, Entity, Column, Index, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { id } from './util/id.js';

@Entity('content_embedding')
export class MiContentEmbedding {
	@PrimaryColumn(id())
	public id: string;

	@Index('IDX_content_embedding_hash_model', { unique: true })
	@Column('varchar', {
		length: 64,
	})
	public contentHash: string;

	@Column('real', { array: true })
	public embedding: number[];

	@Index('IDX_content_embedding_hash_model', { unique: true })
	@Column('varchar', {
		length: 32,
		default: 'distiluse-v1',
	})
	public modelVersion: string;

	@CreateDateColumn()
	public createdAt: Date;

	@UpdateDateColumn()
	public updatedAt: Date;
}
