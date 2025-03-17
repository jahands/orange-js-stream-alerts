import { useLoaderData } from '@orange-js/orange'

import { z } from '@repo/zod'

import type { LoaderFunctionArgs } from '@orange-js/orange'

export type MyTask = z.infer<typeof MyTask>
export const MyTask = z.object({
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

export async function loader({ env }: LoaderFunctionArgs) {
	const id = env.Scheduler.idFromName('scheduler')
	const scheduler = env.Scheduler.get(id)

	const tasks = await scheduler.query({
		type: 'cron',
	})
	console.log(`${tasks.length} tasks are currently scheduled`)
	return z.any().array().parse(tasks)
}

export default function AdminDashboardRoute() {
	const res = useLoaderData<typeof loader>()

	return (
		<main className="flex h-screen w-screen flex-col gap-6 p-8">
			<div>
				<h1>Tasks scheduled:</h1>
				<pre>{JSON.stringify(res, null, 2)}</pre>
			</div>
		</main>
	)
}
