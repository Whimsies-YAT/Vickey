/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import cluster from 'node:cluster';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireAdmin: true,
    secure: true,
	// kind: 'write:admin:graceful-reload',

	errors: {
		clusteringDisabled: {
			message: 'Clustering is disabled.',
			code: 'CLUSTERING_DISABLED',
			id: 'a1c2d3e4-f5a6-7b8c-9d0e-1f2a3b4c5d6e',
		},
		notWorkerProcess: {
			message: 'Not running in worker process.',
			code: 'NOT_WORKER_PROCESS',
			id: 'b2c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e',
		},
		reloadInProgress: {
			message: 'Graceful reload already in progress.',
			code: 'RELOAD_IN_PROGRESS',
			id: 'c3d4e5f6-g7h8-9i0j-1k2l-3m4n5o6p7q8r',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
	) {
		super(meta, paramDef, async (ps, me) => {
			if (!cluster.isWorker) {
				throw new ApiError(meta.errors.clusteringDisabled);
			}

			const masterPid = process.ppid;

			if (!masterPid) {
				throw new ApiError(meta.errors.notWorkerProcess);
			}

			const lockFile = path.join(os.tmpdir(), 'vickey-reload.lock');
			if (fs.existsSync(lockFile)) {
				throw new ApiError(meta.errors.reloadInProgress);
			}

			try {
				process.kill(masterPid, 'SIGHUP');

				return {
					success: true,
					message: 'Graceful reload initiated. New workers will be spawned and old workers will be drained.',
				};
			} catch (error) {
				throw new Error(`Failed to send reload signal: ${error}`);
			}
		});
	}
}
