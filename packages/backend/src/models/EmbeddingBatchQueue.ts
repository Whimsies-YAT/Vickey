import { PrimaryColumn, Entity, Column, Index, CreateDateColumn } from 'typeorm';
import { id } from './util/id.js';

export type EmbeddingBatchStatus = 'pending' | 'processing' | 'completed' | 'failed';

@Entity('embedding_batch_queue')
export class MiEmbeddingBatchQueue {
	@PrimaryColumn(id())
	public id: string;

	@Column(id())
	public contentId: string;

	@Column('text')
	public contentText: string;

	@Column('varchar', {
		length: 64,
	})
	public contentHash: string;

	@Column('int', {
		default: 1,
	})
	public priority: number;

	@Index('IDX_embedding_batch_queue_status_priority')
	@Column('varchar', {
		length: 20,
		default: 'pending',
	})
	public status: EmbeddingBatchStatus;

	@CreateDateColumn()
	public createdAt: Date;

	@Column('timestamp with time zone', {
		nullable: true,
	})
	public processedAt: Date | null;
}
