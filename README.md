# @graphile-contrib/graphql-sse

PostGraphile support for [GraphQL over Server-Sent Events (SSE)](https://github.com/enisdenjo/graphql-sse/blob/master/PROTOCOL.md) powered by [graphql-sse](https://github.com/enisdenjo/graphql-sse).

- Doesn't mess with the schema update stream on `eventSourceRoute`, both can exist on the same route
- `PUT` and `DELETE` methods are allowed through CORS on the `eventSourceRoute` in order to support the ["single connection mode"](https://github.com/enisdenjo/graphql-sse/blob/master/PROTOCOL.md#single-connection-mode)
- The client can use the `X-GraphQL-Event-Stream` header for SSE endpoint discovery

## Getting started

### Install

```bash
npm install --save graphql-sse @graphile-contrib/graphql-sse
```

or

```bash
yarn add graphql-sse @graphile-contrib/graphql-sse
```

### Integrate the plugin

#### PostGraphile CLI

```bash
postgraphile \
  --plugins @graphile/graphql-sse \
  ...
```

#### PostGraphile library

```ts
import { postgraphile, makePluginHook } from 'postgraphile';
import GraphQLSSEPlugin from '@graphile-contrib/graphql-sse';

const postGraphileMiddleware = postgraphile(databaseUrl, 'app_public', {
  pluginHook: makePluginHook([GraphQLSSEPlugin]),
  eventStreamRoute: '/graphql/stream', // default
});
```

### Use the client

Connect to the specified `PostGraphileOptions.eventStreamRoute`.

For further usage inspiration, please consult the [`graphql-sse` readme](https://github.com/enisdenjo/graphql-sse#readme).
