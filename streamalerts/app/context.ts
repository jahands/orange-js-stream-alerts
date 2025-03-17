import type { Scheduler } from 'partywhen'
import type { SharedHonoBindings } from '@repo/hono-helpers'
import type { TwitchAPI } from './lib/TwitchAPI'
import type { StreamMonitor } from './routes/$creator'

export type Env = SharedHonoBindings & {
	// axiom: workers-general 1P-72dx8

	Scheduler: DurableObjectNamespace<Scheduler<Env>>
	StreamMonitor: DurableObjectNamespace<StreamMonitor>
	TwitchAPI: DurableObjectNamespace<TwitchAPI>

	/** 1P-hf1jf (streamalerts-dev)  */
	TWITCH_CLIENT_ID: string
	/** 1P-hf1jf (streamalerts-dev)  */
	TWITCH_CLIENT_SECRET: string
	/** #stream-alerts in Storage server */
	DISCORD_ALERTS_HOOK: string
}
