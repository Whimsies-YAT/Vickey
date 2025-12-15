import { Endpoints as Gen } from './autogen/endpoint.js';
import { UserDetailed } from './autogen/models.js';
import {
	AdminRolesCreateRequest,
	AdminRolesCreateResponse,
	EmptyRequest,
	EmptyResponse,
	UsersShowRequest,
	AdminOauthClientConfigCreateRequest,
	AdminOauthClientConfigCreateResponse,
	AdminOauthClientConfigDeleteRequest,
	AdminOauthClientConfigDeleteResponse,
	AdminOauthClientConfigListResponse,
	AdminOauthClientConfigUpdateRequest,
	AdminOauthClientConfigUpdateResponse,
	SsoProvidersResponse,
} from './autogen/entities.js';
import {
	PartialRolePolicyOverride,
	SigninFlowRequest,
	SigninFlowResponse,
	SigninWithPasskeyInitResponse,
	SigninWithPasskeyRequest,
	SigninWithPasskeyResponse,
	SignupPendingRequest,
	SignupPendingResponse,
	SignupRequest,
	SignupResponse,
	AutoProcessedAbuseReport,
} from './entities.js';

type Overwrite<T, U extends { [Key in keyof T]?: unknown }> = Omit<
	T,
	keyof U
> & U;

type SwitchCase<Condition = unknown, Result = unknown> = {
	$switch: {
		$cases: [Condition, Result][],
		$default: Result;
	};
};

type IsNeverType<T> = [T] extends [never] ? true : false;
type StrictExtract<Union, Cond> = Cond extends Union ? Union : never;

type IsCaseMatched<E extends keyof Endpoints, P extends Endpoints[E]['req'], C extends number> =
	Endpoints[E]['res'] extends SwitchCase
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		? IsNeverType<StrictExtract<Endpoints[E]['res']['$switch']['$cases'][C], [P, any]>> extends false ? true : false
		: false;

type GetCaseResult<E extends keyof Endpoints, P extends Endpoints[E]['req'], C extends number> =
	Endpoints[E]['res'] extends SwitchCase
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		? StrictExtract<Endpoints[E]['res']['$switch']['$cases'][C], [P, any]>[1]
		: never;

/* eslint-disable @stylistic/indent */
export type SwitchCaseResponseType<E extends keyof Endpoints, P extends Endpoints[E]['req']> = Endpoints[E]['res'] extends SwitchCase
	? IsCaseMatched<E, P, 0> extends true ? GetCaseResult<E, P, 0> :
		IsCaseMatched<E, P, 1> extends true ? GetCaseResult<E, P, 1> :
			IsCaseMatched<E, P, 2> extends true ? GetCaseResult<E, P, 2> :
				IsCaseMatched<E, P, 3> extends true ? GetCaseResult<E, P, 3> :
					IsCaseMatched<E, P, 4> extends true ? GetCaseResult<E, P, 4> :
						IsCaseMatched<E, P, 5> extends true ? GetCaseResult<E, P, 5> :
							IsCaseMatched<E, P, 6> extends true ? GetCaseResult<E, P, 6> :
								IsCaseMatched<E, P, 7> extends true ? GetCaseResult<E, P, 7> :
									IsCaseMatched<E, P, 8> extends true ? GetCaseResult<E, P, 8> :
										IsCaseMatched<E, P, 9> extends true ? GetCaseResult<E, P, 9> :
											Endpoints[E]['res']['$switch']['$default'] : Endpoints[E]['res'];
/* eslint-enable @stylistic/indent */

export type Endpoints = Overwrite<
	Gen,
	{
		'users/show': {
			req: UsersShowRequest;
			res: {
				$switch: {
					$cases: [[
						{
							userIds?: string[];
						}, UserDetailed[],
					]];
					$default: UserDetailed;
				};
			};
		},
		// api.jsonには載せないものなのでここで定義
		'signup': {
			req: SignupRequest;
			res: SignupResponse;
		},
		// api.jsonには載せないものなのでここで定義
		'signup-pending': {
			req: SignupPendingRequest;
			res: SignupPendingResponse;
		},
		// api.jsonには載せないものなのでここで定義
		'signin-flow': {
			req: SigninFlowRequest;
			res: SigninFlowResponse;
		},
		'signin-with-passkey': {
			req: SigninWithPasskeyRequest;
			res: {
				$switch: {
					$cases: [
						[
							{
								context: string;
							},
							SigninWithPasskeyResponse,
						],
					];
					$default: SigninWithPasskeyInitResponse;
				},
			},
		},
		'admin/roles/create': {
			req: Overwrite<AdminRolesCreateRequest, { policies: PartialRolePolicyOverride }>;
			res: AdminRolesCreateResponse;
		},
		'admin/abuse-report/auto-processed/show': {
			req: Gen['admin/abuse-report/auto-processed/show']['req'];
			res: AutoProcessedAbuseReport[];
		},
		'admin/show-user': {
			req: Gen['admin/show-user']['req'];
			res: Gen['admin/show-user']['res'] & { approved?: boolean };
		},
		'admin/show-pending': {
			req: Gen['admin/show-pending']['req'];
			res: Gen['admin/show-pending']['res'] & {
				signupReason?: string | null;
				time?: string;
				isProcessed?: boolean;
				result?: string | null;
				ip?: string | null;
			};
		},
		'clear-browser-cache': {
			req: EmptyRequest;
			res: EmptyResponse;
		},
		'admin/oauth-client-config/create': {
			req: AdminOauthClientConfigCreateRequest;
			res: AdminOauthClientConfigCreateResponse;
		},
		'admin/oauth-client-config/delete': {
			req: AdminOauthClientConfigDeleteRequest;
			res: AdminOauthClientConfigDeleteResponse;
		},
		'admin/oauth-client-config/list': {
			req: EmptyRequest;
			res: AdminOauthClientConfigListResponse;
		},
		'admin/oauth-client-config/update': {
			req: AdminOauthClientConfigUpdateRequest;
			res: AdminOauthClientConfigUpdateResponse;
		},
		'sso/providers': {
			req: EmptyRequest;
			res: SsoProvidersResponse;
		},
	}
>;
