# graphql-sse

PostGraphile support for [GraphQL over Server-Sent Events (SSE)](https://github.com/enisdenjo/graphql-sse/blob/master/PROTOCOL.md) powered by [graphql-sse](https://github.com/enisdenjo/graphql-sse)

## Getting started

### Install

```bash
npm install --save graphql-sse @graphile-contrib/graphql-sse
```

or

```bash
yarn add graphql-sse @graphile-contrib/graphql-sse
```

### Use the plugin

```ts
import { postgraphile, makePluginHook } from "postgraphile";
import { GraphQLSSEPlugin } from "@graphile-contrib/graphql-sse";

const pluginHook = makePluginHook([GraphQLSSEPlugin]);

const postGraphileMiddleware = postgraphile(databaseUrl, "app_public", {
  eventStreamRoute: "/graphql/stream", // default
  pluginHook,
});
```

### Use the client

Connect using the `graphql-sse` client to the specified `eventStreamRoute` (defaults to `/graphql/stream`).

For further usage inspiration, please consult the [`graphql-sse` readme](https://github.com/enisdenjo/graphql-sse#readme).
