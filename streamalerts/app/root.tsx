import {
	isRouteErrorResponse,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
} from '@orange-js/orange'
import { match, P } from 'ts-pattern'

import { NotFoundError } from './lib/errors'
import rootStyles from './root.css?inline'

import type { LinksFunction, MetaFunction } from '@orange-js/orange'

export const links: LinksFunction = () => [
	{ rel: 'preconnect', href: 'https://fonts.googleapis.com' },
	{
		rel: 'preconnect',
		href: 'https://fonts.gstatic.com',
		crossOrigin: 'anonymous',
	},
	{
		rel: 'stylesheet',
		href: 'https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap',
	},
	{
		rel: 'icon',
		type: 'image/svg+xml',
		href: '/favicon.svg',
	},
]

export const meta: MetaFunction = () => {
	return [
		{ title: 'Stream Alerts for Twitch.tv' },
		{
			name: 'og:title',
			content: 'Stream Alerts for Twitch.tv',
		},
		{
			name: 'description',
			content: 'A tool for getting alerts when a Twitch creator goes live',
		},
		{
			name: 'og:description',
			content: 'A tool for getting alerts when a Twitch creator goes live',
		},
	]
}

export function Layout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<Meta />
				<Links />
				<style>{rootStyles}</style>
			</head>
			<body>
				{children}
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	)
}

export default function App() {
	return <Outlet />
}

export function ErrorBoundary({ error }: { error: unknown }) {
	let message = 'Oops!'
	let details = 'An unexpected error occurred.'
	let stack: string | undefined

	if (isRouteErrorResponse(error)) {
		message = error.status === 404 ? '404' : 'Error'

		details = match(error)
			.with({ status: 404 }, () => 'The requested page could not be found.')
			.with(
				{ status: 400, data: P.nonNullable },
				({ data }) => `Bad Request: ${JSON.stringify(data)}`
			)
			.with({ status: 400 }, () => 'Bad Request')
			.otherwise(() => 'An unexpected error occurred') satisfies string
	} else if (error instanceof NotFoundError) {
		message = '404'
		details = 'The requested page could not be found.'
	} else if (import.meta.env.DEV && error && error instanceof Error) {
		details = error.message
		stack = error.stack
	}

	return (
		<main className="container mx-auto p-4 pt-16">
			<h1>{message}</h1>
			<p>{details}</p>
			{stack && (
				<pre className="w-full overflow-x-auto p-4">
					<code>{stack}</code>
				</pre>
			)}
		</main>
	)
}
