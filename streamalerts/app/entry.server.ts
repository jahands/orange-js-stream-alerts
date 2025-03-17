import { zValidator } from '@hono/zod-validator'
import { app } from '@orange-js/orange/server'
import { Hono } from 'hono'
import * as serverBuild from 'virtual:orange/server-bundle'

import {
	getTracingConfig,
	useAxiomLogger,
	useMeta,
	useOnError,
	useSentry,
} from '@repo/hono-helpers'
import { instrument } from '@repo/otel'
import { z } from '@repo/zod'

import { initSentry } from './lib/sentry'

import type { HonoApp as BaseHonoApp, SharedHonoVariables } from '@repo/hono-helpers'

export * from 'virtual:orange/entrypoints'

export { Scheduler } from 'partywhen'
export { TwitchAPI } from './lib/TwitchAPI'

/** Variables can be extended */
export type Variables = SharedHonoVariables

export interface HonoApp extends BaseHonoApp {
	Bindings: Env
	Variables: SharedHonoVariables
}

const honoApp = new Hono<HonoApp>()
	.use(
		'*', // Middleware
		useMeta,
		useSentry(initSentry, 'http.server'),
		useAxiomLogger
	)

	// Hooks
	.onError(useOnError())

	.get(
		'/api/:creator/streamdeck',
		zValidator('param', z.object({ creator: z.string() })),
		async (c) => {
			const { creator } = c.req.valid('param')
			const id = c.env.StreamMonitor.idFromName(creator)
			const monitor = c.env.StreamMonitor.get(id)
			const state = await monitor.getState()
			const profileImageUrl = state.profileImageUrl
			if (state.status.isLive) {
				return fetch(profileImageUrl, {
					cf: {
						image: {
							fit: 'scale-down',
							width: 280,
						},
					},
				})
			} else {
				return fetch(profileImageUrl, {
					cf: {
						image: {
							saturation: 0,
							fit: 'scale-down',
							width: 280,
						},
					},
				})
			}
		}
	)

	// Route all requests to the orange-js app
	.mount('/', app(serverBuild).fetch)

const handler = {
	fetch: honoApp.fetch,
} satisfies ExportedHandler<Env>

export default instrument(handler, getTracingConfig<HonoApp>())
