import { useLoaderData } from '@orange-js/orange'
import { data } from 'react-router'

import { z } from '@repo/zod'

import type { LoaderFunctionArgs } from '@orange-js/orange'

export type Creator = z.infer<typeof Creator>
export const Creator = z.enum(['sevadus', 'darkostoafk'])

const Params = z.object({ creator: Creator })

export type CronTask = z.infer<typeof CronTask>
export const CronTask = z.object({
	id: z.string(),
	description: z.string(),
	payload: z.object({ creator: z.string() }),
	callback: z.object({
		type: z.string(),
		namespace: z.string(),
		name: z.string(),
		function: z.string(),
	}),
	cron: z.string(),
	time: z.coerce.date(),
	type: z.string(),
})

export async function loader({ env, params }: LoaderFunctionArgs) {
	const maybeParams = Params.safeParse(params)
	if (!maybeParams.success) {
		throw data(JSON.stringify(maybeParams.error.format()), { status: 400 })
	}

	const { creator } = maybeParams.data
	const id = env.Scheduler.idFromName('scheduler')
	const scheduler = env.Scheduler.get(id)

	const task = await scheduler.scheduleTask({
		id: creator,
		description: `Check if twitch.tv/${creator} is live`,
		type: 'cron',
		cron: '*/5 * * * *',
		payload: {
			creator,
		},
		callback: {
			type: 'durable-object',
			namespace: 'StreamMonitor',
			name: creator,
			function: 'checkStatus',
		},
	})
	console.log('Task scheduled:', task)
	return CronTask.parse(task)
}

export default function CreatorScheduleRoute() {
	const res = useLoaderData<typeof loader>()

	return (
		<main className="flex h-screen w-screen flex-col gap-6 p-8">
			<div>
				<h1>Task scheduled:</h1>
				<pre>{JSON.stringify(res, null, 2)}</pre>
			</div>
		</main>
	)
}
