import { RouteDurableObject, useDurableObject } from '@orange-js/orange'
import { state } from 'diffable-objects'
import { DateTime } from 'luxon'
import pRetry from 'p-retry'

import { z } from '@repo/zod'

import { NotFoundError } from '../lib/errors'
import { getTwitchAPIClient } from '../lib/TwitchAPI'
import { Creator, CronTask } from './$creator_.schedule'

import type {
	DurableLoaderFunctionArgs,
	IdentifierFunctionArgs,
	MetaFunction,
} from '@orange-js/orange'

export type State = {
	creator: string
}

export type StreamStatus = z.infer<typeof StreamStatus>
export const StreamStatus = z.discriminatedUnion('isLive', [
	z.object({
		isLive: z.literal(false),
	}),
	z.object({
		isLive: z.literal(true),
		streamId: z.string(),
		thumbnailUrl: z.string(),
		/**
		 * Unix timestamp (in milliseconds) when the discord hook was sent for this streamId.
		 * If null, no hook has been sent yet.
		 */
		discordHookSentOn: z.number().nullable(),
	}),
])

export type StreamMonitorState = z.infer<typeof StreamMonitorState>
export const StreamMonitorState = z.object({
	creator: z.string(),
	profileImageUrl: z.string(),
	offlineImageUrl: z.string(),
	creatorDisplayName: z.string(),
	status: StreamStatus,
})

export class StreamMonitor extends RouteDurableObject<Env> {
	// @diffable
	// private state = { creator: '' }
	private state = state(this.ctx, 'state_v4', {
		creator: '',
		creatorDisplayName: '',
		profileImageUrl: '',
		offlineImageUrl: '',
		status: {
			isLive: false,
		},
	} as StreamMonitorState)

	async loader({ params }: DurableLoaderFunctionArgs): Promise<StreamMonitorState> {
		const { creator } = params
		if (!Creator.safeParse(creator).success) {
			this.ctx.waitUntil(this.ctx.storage.deleteAll())
			throw new NotFoundError('invalid creator')
		}

		this.state.creator = z.string().min(1).parse(params.creator)

		// only check creatorDisplayName because sometimes the others may not be set
		if (!this.state.creatorDisplayName) {
			const twitch = getTwitchAPIClient(this.env)
			const res = await twitch.getUser(this.state.creator)
			if (res.data.length > 0) {
				const user = res.data[0]
				this.state.creatorDisplayName = user.display_name
				this.state.profileImageUrl = user.profile_image_url
				this.state.offlineImageUrl = user.offline_image_url
			}
		}
		return z.parse(StreamMonitorState, this.state)
	}

	async getState(): Promise<StreamMonitorState> {
		return z.parse(StreamMonitorState, this.state)
	}

	/** checkStatus is called by a cron */
	async checkStatus(cronTask: CronTask): Promise<void> {
		try {
			const task = CronTask.parse(cronTask)
			console.log('checkStatus() called!', JSON.stringify(task))

			if (this.state.creator === '') {
				throw new Error(
					`state had empty creator when checkStatus was called! task.payload.creator=${task.payload.creator}`
				)
			}
			if (task.payload.creator !== this.state.creator) {
				throw new Error(
					`checkStatus called with incorrect creator! wanted "${this.state.creator}" but got "${task.payload.creator}"`
				)
			}

			const twitch = getTwitchAPIClient(this.env)
			const res = await twitch.getChannelStatus(this.state.creator)
			const stream = res.data.find((s) => s.type === 'live')
			if (stream) {
				let discordHookSentOn = null
				// If the stream was already live and hasn't changed (or we recently
				// sent a hook), use previous discordHookSentOn value
				if (this.state.status.isLive && this.state.status.discordHookSentOn) {
					const hookSentOn = DateTime.fromMillis(this.state.status.discordHookSentOn)
					if (
						this.state.status.streamId === stream.id ||
						hookSentOn > DateTime.now().minus({ hours: 8 })
					) {
						discordHookSentOn = this.state.status.discordHookSentOn
					}
				}

				this.state.status = z.parse(StreamStatus, {
					isLive: true,
					streamId: stream.id,
					thumbnailUrl: stream.thumbnail_url,
					// if we're already live, use the previous discordHookSentOn value
					discordHookSentOn,
				})

				// now send a hook if we're live and it hasn't been sent yet
				if (!discordHookSentOn) {
					const thumbnail = stream.thumbnail_url.replace('-{width}x{height}', '')
					await pRetry(
						async () => {
							if (!this.state.status.isLive) {
								return // stream is no longer live
							}

							const mentionMe = '<@85379843826413568>' // @geostyx
							const r = await fetch(`${this.env.DISCORD_ALERTS_HOOK}?wait=true`, {
								method: 'POST',
								headers: {
									'content-type': 'application/json',
								},
								body: JSON.stringify({
									content: `${this.state.creatorDisplayName} is live! cc ${mentionMe}`,
									embeds: [
										{
											title: `Watch ${this.state.creatorDisplayName} now!`,
											url: `https://twitch.tv/${this.state.creator}`,
											image: {
												url: thumbnail,
											},
											color: 15277667,
										},
									],
								}),
							})
							if (!r.ok) {
								throw new Error(`failed to send discord hook: ${r.status} - ${await r.text()}`)
							}
							this.state.status.discordHookSentOn = Date.now()
						},
						{ retries: 0, randomize: true }
					)
				}
			} else {
				this.state.status = z.parse(StreamStatus, { isLive: false })
			}
		} catch (e) {
			console.error(`failed to check twitch status for ${this.state.creatorDisplayName}:`, e)
		}
	}

	static id({ params }: IdentifierFunctionArgs) {
		const { creator } = params
		return creator
	}
}

export const meta: MetaFunction = ({ data }) => {
	const stream = StreamMonitorState.safeParse(data)
	if (!stream.success) {
		return []
	}
	const { creatorDisplayName, status, offlineImageUrl } = stream.data

	return [
		{ title: `${creatorDisplayName} - ${status.isLive ? 'Live Now' : 'Offline'}` },
		{
			name: 'description',
			content: `${creatorDisplayName} is currently ${status.isLive ? 'live' : 'offline'} on Twitch`,
		},
		{
			property: 'og:title',
			content: `${creatorDisplayName} - ${status.isLive ? 'Live Now' : 'Offline'}`,
		},
		{
			property: 'og:description',
			content: `${creatorDisplayName} is currently ${status.isLive ? 'live' : 'offline'} on Twitch`,
		},
		{ property: 'og:type', content: 'website' },
		{
			property: 'og:image',
			content: status.isLive
				? status.thumbnailUrl.replace('-{width}x{height}', '-1280x720')
				: offlineImageUrl,
		},
		{ property: 'og:image:width', content: '1280' },
		{ property: 'og:image:height', content: '720' },
		{ name: 'twitter:card', content: 'summary_large_image' },
		{
			name: 'twitter:title',
			content: `${creatorDisplayName} - ${status.isLive ? 'Live Now' : 'Offline'}`,
		},
		{
			name: 'twitter:description',
			content: `${creatorDisplayName} is currently ${status.isLive ? 'live' : 'offline'} on Twitch`,
		},
		{
			name: 'twitter:image',
			content: status.isLive
				? status.thumbnailUrl.replace('-{width}x{height}', '-1280x720')
				: offlineImageUrl,
		},
	]
}

export default function CreatorStatusRoute() {
	const { creatorDisplayName, status, offlineImageUrl, profileImageUrl, creator } =
		useDurableObject<StreamMonitor>()

	return (
		<main className="flex min-h-screen w-screen flex-col items-center justify-center bg-gray-900 p-8">
			<div className="w-full max-w-2xl rounded-lg bg-gray-800 p-8 shadow-xl shadow-black/20">
				<div className="flex flex-col items-center gap-6">
					<a
						href={`https://twitch.tv/${creator}`}
						target="_blank"
						rel="noopener noreferrer"
						className="relative h-32 w-32 overflow-hidden rounded-full ring-2 ring-gray-700 transition-colors hover:ring-blue-500"
					>
						<div className="absolute inset-0 animate-pulse bg-gray-700" />
						<img
							src={profileImageUrl}
							alt={`${creatorDisplayName}'s profile`}
							className="relative h-full w-full object-cover"
						/>
					</a>

					<a
						href={`https://twitch.tv/${creator}`}
						target="_blank"
						rel="noopener noreferrer"
						className="text-3xl font-bold text-white transition-colors hover:text-blue-400"
					>
						{creatorDisplayName}
					</a>

					<a
						href={`https://twitch.tv/${creator}`}
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-2 transition-colors hover:text-blue-400"
					>
						<div
							className={`h-3 w-3 rounded-full ${status.isLive ? 'animate-pulse bg-red-500' : 'bg-gray-600'}`}
						/>
						<span className="text-lg font-medium text-gray-300">
							{status.isLive ? 'Live Now' : 'Offline'}
						</span>
					</a>

					{status.isLive ? (
						<a
							href={`https://twitch.tv/${creator}`}
							target="_blank"
							rel="noopener noreferrer"
							className="relative aspect-video w-full overflow-hidden rounded-lg ring-1 ring-gray-700 transition-colors hover:ring-blue-500"
						>
							<div className="absolute inset-0 animate-pulse bg-gray-700" />
							<img
								src={status.thumbnailUrl.replace('-{width}x{height}', '')}
								alt={`${creatorDisplayName}'s stream thumbnail`}
								className="relative h-full w-full object-cover"
							/>
						</a>
					) : (
						offlineImageUrl && (
							<a
								href={`https://twitch.tv/${creator}`}
								target="_blank"
								rel="noopener noreferrer"
								className="relative aspect-video w-full overflow-hidden rounded-lg ring-1 ring-gray-700 transition-colors hover:ring-blue-500"
							>
								<div className="absolute inset-0 animate-pulse bg-gray-700" />
								<img
									src={offlineImageUrl}
									alt={`${creatorDisplayName}'s offline banner`}
									className="relative h-full w-full object-cover"
								/>
							</a>
						)
					)}
				</div>
			</div>
		</main>
	)
}
