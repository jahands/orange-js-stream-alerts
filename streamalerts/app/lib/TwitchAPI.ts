import { DurableObject } from 'cloudflare:workers'
import { state } from 'diffable-objects'
import { DateTime } from 'luxon'

import { z } from '@repo/zod'

import { NotFoundError } from './errors'

/**
 * POST id.twitch.tv/oauth2/token
 *
 * https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#client-credentials-grant-flow
 */
export type AccessTokenResponse = z.infer<typeof AccessTokenResponse>
export const AccessTokenResponse = z.object({
	access_token: z.string(),
	/** How long the new token is valid for (in seconds, I think) */
	expires_in: z.number(),
	token_type: z.literal('bearer'),
})

export type AccessToken = z.infer<typeof AccessToken>
export const AccessToken = z.object({
	access_token: AccessTokenResponse.shape.access_token,
	/** Expiration timestamp in milliseconds */
	expires_on: z.number(),
})

function isTokenExpired(expires_on: number): boolean {
	return DateTime.fromMillis(expires_on) < DateTime.now()
}

/**
 * GET https://api.twitch.tv/helix/streams
 *
 * https://dev.twitch.tv/docs/api/reference/#get-streams
 */
export type StreamResponse = z.infer<typeof StreamResponse>
export const StreamResponse = z.object({
	data: z.array(
		z.object({
			id: z.string(),
			user_id: z.string(),
			user_login: z.string(),
			user_name: z.string(),
			game_id: z.string(),
			game_name: z.string(),
			type: z.enum(['live']).or(z.string().and(z.object({}))),
			title: z.string(),
			viewer_count: z.number(),
			started_at: z.string(),
			language: z.string(),
			thumbnail_url: z.string(),
			tag_ids: z.array(z.any()),
			tags: z.array(z.string()),
			is_mature: z.boolean(),
		})
	),
	pagination: z.object({ cursor: z.string().optional() }),
})

export type UserResponse = z.infer<typeof UserResponse>
export const UserResponse = z.object({
	data: z.array(
		z.object({
			id: z.string(),
			login: z.string(),
			display_name: z.string(),
			type: z.string(),
			broadcaster_type: z.string(),
			description: z.string(),
			profile_image_url: z.string(),
			offline_image_url: z.string(),
			view_count: z.number(),
			created_at: z.string(),
		})
	),
})

async function newAPIError(description: string, res: Response): Promise<Error> {
	return new Error(`${description}: ${res.status} - ${await res.text()}`)
}

export class TwitchAPI extends DurableObject<Env> {
	// @diffable
	// private token = { access_token: '', expires_on: 0 } satisfies AccessToken
	private state = state(this.ctx, 'state_v3', {
		token: {
			access_token: '',
			expires_on: 0,
		} satisfies AccessToken,
	})

	/** Ensure we only force refresh once by tracking status here */
	private isForceRefreshing = false

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
	}

	async getToken(): Promise<AccessToken> {
		console.log('getToken() called!', JSON.stringify({ expires_on: this.state.token.expires_on }))
		if (!this.state.token.access_token || isTokenExpired(this.state.token.expires_on)) {
			await this.refreshToken()
			return z.parse(AccessToken, this.state.token)
		} else {
			return z.parse(AccessToken, this.state.token)
		}
	}

	/**
	 * Refresh the token
	 * @param forceRefresh Refresh regardless of expiration status
	 */
	async refreshToken({ forceRefresh }: { forceRefresh?: boolean } = {}): Promise<void> {
		// use blockConcurrencyWhile to ensure multiple
		// requests don't refresh it at the same time
		await this.ctx.blockConcurrencyWhile(async () => {
			if (forceRefresh) {
				if (this.isForceRefreshing) {
					console.log('token already force refreshing! skipping...')
					return
				} else {
					this.isForceRefreshing = true
				}
			}

			try {
				// Make sure we didn't already refresh it
				if (!isTokenExpired(this.state.token.expires_on) && !forceRefresh) {
					console.log('token already refreshed! skipping...')
					return
				}

				console.log('refreshing twitch token')

				const url = new URL('https://id.twitch.tv/oauth2/token')
				url.searchParams.set('client_id', this.env.TWITCH_CLIENT_ID)
				url.searchParams.set('client_secret', this.env.TWITCH_CLIENT_SECRET)
				url.searchParams.set('grant_type', 'client_credentials')
				const res = await fetch(url, {
					method: 'POST',
				})
				if (!res.ok) {
					throw await newAPIError(`Failed to refresh token`, res)
				}
				const body = AccessTokenResponse.parse(await res.json())

				// this should expire in ~60 days, so refresh a bit before
				const expiresOn = DateTime.now().plus({ seconds: body.expires_in }).minus({ hours: 1 })
				if (expiresOn < DateTime.now()) {
					throw new Error(
						`calculated expiration is in the past: ${JSON.stringify(body)} - ${expiresOn}`
					)
				}

				this.state.token = z.parse(AccessToken, {
					access_token: body.access_token,
					expires_on: expiresOn.toMillis(),
				})
			} finally {
				if (forceRefresh) {
					this.isForceRefreshing = false
				}
			}
		})
	}
}

/**
 * A Twitch client that calls out to TwitchAPI DO to get
 * a token, but runs all other operations on the edge.
 */
export class TwitchAPIClient {
	private _twitch: DurableObjectStub<TwitchAPI> | undefined
	private token: AccessToken | undefined

	constructor(private readonly env: Env) {}

	private get twitch(): DurableObjectStub<TwitchAPI> {
		if (!this._twitch) {
			const id = this.env.TwitchAPI.idFromName('default')
			this._twitch = this.env.TwitchAPI.get(id)
		}
		return this._twitch
	}

	private async getToken(): Promise<AccessToken> {
		console.log('TwitchAPIClient.getToken()', { expires_on: this.token?.expires_on })
		if (!this.token || isTokenExpired(this.token.expires_on)) {
			this.token = await this.twitch.getToken()
		}
		return this.token
	}

	private async getAuthHeaders(): Promise<{ Authorization: string; 'Client-ID': string }> {
		const { access_token } = await this.getToken()
		return {
			Authorization: `Bearer ${access_token}`,
			'Client-ID': this.env.TWITCH_CLIENT_ID,
		}
	}

	private async apiFetch(url: string | URL, init?: RequestInit): Promise<Response> {
		const doFetch = async () =>
			fetch(url, {
				...init,
				headers: {
					...(await this.getAuthHeaders()),
					...init?.headers,
				},
			})

		const res = await doFetch()
		if (res.status === 401) {
			// maybe the token is expired despite expires_on being in the future?
			await this.twitch.refreshToken({ forceRefresh: true })
			return await doFetch()
		} else {
			return res
		}
	}

	// ============================ //
	// =========== APIs =========== //
	// ============================ //

	/**
	 * Get the channel's streams.
	 *
	 * @throws NotFoundError if the channel is not found
	 * @throws error for all other non-OK responses
	 */
	async getChannelStatus(creator: string): Promise<StreamResponse> {
		const res = await this.apiFetch(`https://api.twitch.tv/helix/streams?user_login=${creator}`)
		if (!res.ok) {
			if (res.status === 404) {
				throw new NotFoundError(`channel not found: ${creator}`)
			} else {
				throw await newAPIError('failed to get channel status', res)
			}
		}
		const body = await res.json()
		console.log('getChannelResponse body', body)
		return StreamResponse.parse(body)
	}

	async getUser(creator: string): Promise<UserResponse> {
		const res = await this.apiFetch(`https://api.twitch.tv/helix/users?login=${creator}`)
		if (!res.ok) {
			if (res.status === 404) {
				throw new NotFoundError(`user not found: ${creator}`)
			} else {
				throw await newAPIError('failed to get user', res)
			}
		}
		const body = await res.json()
		console.log('getUser body', body)
		return UserResponse.parse(body)
	}
}

export function getTwitchAPIClient(env: Env): TwitchAPIClient {
	return new TwitchAPIClient(env)
}
