import type { AnyRouter } from "../server/router";
import {
	LiveQueryClient,
	type HeadersResolver,
	type LiveQueryClientOptions,
} from "./client";
import { createFlatProxy, createRecursiveProxy } from "../proxy";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { useRequestSub } from "./useRequestSub";
import { getArrayQueryKey } from "./getArrayQueryKey";
import type { CreateLiveQueryReact } from "./types";
import { getQueryKey } from "./getQueryKey";
import { useContext, useEffect, useRef, useState } from "react";
import { MockNetRequestContext } from "./mockContext";
import { addDataCallback } from "./useDataResponse";
import { useLiveQuery } from "./liveQueryContext";
import uniqid from "@thorium/uniqid";
import { stableValueHash } from "./stableValueHash";

export function createReactProxyDecoration(name: string, fns: any) {
	return createRecursiveProxy((opts) => {
		const args = opts.args;

		const pathCopy = [name, ...opts.path];

		// The last arg is for instance `.useMutation` or `.useQuery()`
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		const lastArg = pathCopy.pop()!;

		// The `path` ends up being something like `post.byId`
		const path = pathCopy.join(".");
		if (lastArg === "useNetSend") {
			return (fns as any)[lastArg](path, ...args);
		}
		const [input, ...rest] = args;

		return (fns as any)[lastArg](path, input, ...rest);
	});
}

function createHooksInternalProxy<TRouter extends AnyRouter>(
	client: LiveQueryClient,
) {
	const dataStreamMap = new Map<string, Set<string>>();

	type CreateHooksInternalProxy = CreateLiveQueryReact<TRouter>;
	const fns = {
		netRequest: (
			path: string,
			input: any,
			{
				headers,
				signal,
			}: { headers?: HeadersResolver; signal?: AbortSignal } = {},
		) => {
			return client.netRequest({ path, input, headers, signal });
		},
		getQueryKey: (path: string, input: any) => {
			return getArrayQueryKey(getQueryKey(path, input));
		},
		useNetRequest: (path: string, input: any, ...args: unknown[]) => {
			const data = useContext(MockNetRequestContext);
			useRequestSub({ path, params: input }, data);
			const firstArg = args[0] || {};
			const { callback, ...opts } = firstArg as any;
			const queryKey = getArrayQueryKey(getQueryKey(path, input));
			const result = useSuspenseQuery({
				...opts,
				queryFn: ({ signal }: { signal: any }) => {
					if (data) {
						return path.split(".").reduce((prev, next) => prev[next], data);
					}
					return client.netRequest({ path, input, signal });
				},
				queryKey,
				refetchOnMount: false,
				refetchOnReconnect: false,
				refetchOnWindowFocus: false,
				networkMode: "always",
				staleTime: Number.POSITIVE_INFINITY,
				cacheTime: Number.POSITIVE_INFINITY,
				enabled: opts.enabled,
			});
			const key = JSON.stringify(queryKey);

			const callbackRef = useRef<(data: unknown) => void>(callback);
			useEffect(() => {
				callbackRef.current = callback;
			}, [callback]);
			useEffect(() => {
				if (callbackRef.current) {
					const unsub = addDataCallback(key, callbackRef.current);

					return () => unsub();
				}
			}, [key]);

			return [result.data, result];
		},
		netSend: (
			path: string,
			input: any,
			{
				headers,
				signal,
			}: { headers?: HeadersResolver; signal?: AbortSignal } = {},
		) => client.netSend({ path, input, headers, signal }),
		useNetSend: (path: string, ...args: unknown[]) =>
			useMutation({
				mutationFn: (input) => client.netSend({ path, input }),
				...(args[0] as any),
			}),
		useDataStream: (path: string, ...args: unknown[]) => {
			const params = args[0];
			const id = stableValueHash({ path, params });
			const [hookId] = useState(uniqid());
			const { socket, reconnectionState } = useLiveQuery();
			const isConnected = reconnectionState === "connected";

			// biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
			useEffect(() => {
				if (!socket || !isConnected) return;
				if (!dataStreamMap.has(id)) {
					dataStreamMap.set(id, new Set());
				}
				if (dataStreamMap.get(id)?.size === 0) {
					// Subscribe to the effect
					socket.send("dataStream", { path, params, id });
				}

				dataStreamMap.get(id)?.add(hookId);

				return () => {
					dataStreamMap.get(id)?.delete(hookId);
					if (!dataStreamMap.get(id) || dataStreamMap.get(id)?.size === 0) {
						// Unsubscribe from the effect
						socket.send("dataStreamEnd", { id });
					}
				};
				// The request ID is a stable way to represent the missing dependencies
			}, [socket, hookId, id, isConnected]);
		},
	};
	return createFlatProxy<CreateHooksInternalProxy>((key) => {
		// if (key === 'useContext') {
		//   return () => {
		//     const context = trpc.useContext();
		//     // create a stable reference of the utils context
		//     return useMemo(() => {
		//       return (createReactQueryUtilsProxy as any)(context);
		//     }, [context]);
		//   };
		// }

		// biome-ignore lint/suspicious/noPrototypeBuiltins:
		if (fns.hasOwnProperty(key)) {
			return (fns as any)[key];
		}

		return createReactProxyDecoration(key as string, fns);
	});
}

export function createLiveQueryReact<TRouter extends AnyRouter>(
	opts?: LiveQueryClientOptions,
) {
	const client = new LiveQueryClient(opts);
	const proxy = createHooksInternalProxy<TRouter>(client);

	return proxy;
}
