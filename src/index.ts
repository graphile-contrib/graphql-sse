import type { IncomingMessage, ServerResponse } from 'http';
import type {
  parse as graphqlParse,
  validate as graphqlValidate,
  execute as graphqlExecute,
  subscribe as graphqlSubscribe,
  specifiedRules as graphqlSpecifiedRules,
} from 'graphql';
import type {
  CreateRequestHandlerOptions,
  PostGraphilePlugin,
} from 'postgraphile';

import { createHandler, Handler, TOKEN_HEADER_KEY } from 'graphql-sse';

// copied from https://github.com/graphile/postgraphile/blob/55bff41460b113481c8161ef8f178f5af0a17df3/src/postgraphile/pluginHook.ts#L21-L25
// TODO: export from postgraphile or find if already exported?
type PluginHookFn = <TArgument, TContext = Record<string, any>>(
  hookName: string,
  argument: TArgument,
  context?: TContext,
) => TArgument;

let eventStreamRoute = '',
  handler: Handler = () => {
    throw new Error('graphql-sse handler not initialised');
  },
  parse: typeof graphqlParse = () => {
    throw new Error('graphql parse not initialised');
  },
  specifiedRules: typeof graphqlSpecifiedRules,
  validate: typeof graphqlValidate = () => {
    throw new Error('graphql validate not initialised');
  },
  execute: typeof graphqlExecute = () => {
    throw new Error('graphql execute not initialised');
  },
  subscribe: typeof graphqlSubscribe = () => {
    throw new Error('graphql subscribe not initialised');
  },
  pluginHook: PluginHookFn = () => {
    throw new Error('PostGraphile pluginHook not initialised');
  };

// some callbacks of graphql-sse dont supply the response (like onNext)
const resForReq = new Map<IncomingMessage, ServerResponse>();

export const GraphQLSSEPlugin: PostGraphilePlugin = {
  init(_, { graphql }) {
    // copied from https://github.com/graphile/postgraphile/blob/55bff41460b113481c8161ef8f178f5af0a17df3/isTurbo.js
    const major = parseInt(process.version.replace(/\..*$/, ''), 10);
    if (major < 12) {
      throw new Error('graphql-sse requres Node >=12');
    }

    parse = graphql.parse;
    specifiedRules = graphql.specifiedRules;
    validate = graphql.validate;
    execute = graphql.execute;
    subscribe = graphql.subscribe;

    return null;
  },
  pluginHook(postgraphilePluginHook) {
    return (pluginHook = postgraphilePluginHook);
  },
  'postgraphile:middleware'(middleware) {
    const {
      options,
      getGraphQLSchema,
      withPostGraphileContextFromReqRes,
      handleErrors,
    } = middleware;

    // intentionally not taking from options because middleware will guarantee there's a route
    eventStreamRoute = middleware.eventStreamRoute;
    if (!eventStreamRoute) {
      throw new Error(
        'graphql-sse cannot start because of eventStreamRoute is missing',
      );
    }

    const staticValidationRules = pluginHook(
      'postgraphile:validationRules:static',
      specifiedRules,
      {
        options,
      },
    );

    handler = createHandler<IncomingMessage, ServerResponse>({
      execute,
      subscribe,
      validate(schema, document) {
        const validationErrors = validate(
          schema,
          document,
          staticValidationRules,
        );
        if (validationErrors.length) {
          return validationErrors;
        }

        // TODO: implement if necessary
        // // You are strongly encouraged to use
        // // `postgraphile:validationRules:static` if possible - you should
        // // only use this one if you need access to variables.
        // const moreValidationRules = pluginHook('postgraphile:validationRules', [], {
        //   options,
        //   req,
        //   res,
        //   variables: variableValues,
        //   operationName: operationName,
        // });
        // if (moreValidationRules.length) {
        //   const moreValidationErrors = validate(schema, document, moreValidationRules);
        //   if (moreValidationErrors.length) {
        //     return moreValidationErrors;
        //   }
        // }

        return [];
      },
      async onSubscribe(req, res, params) {
        const context = await withPostGraphileContextFromReqRes(
          req,
          res,
          { singleStatement: true },
          (context) => context,
        );

        const schema = await getGraphQLSchema();

        return {
          schema,
          contextValue: context,
          operationName: params.operationName,
          document:
            typeof params.query === 'string'
              ? parse(params.query)
              : params.query,
          variableValues: params.variables,
        };
      },
      async onNext(req, _args, result) {
        if (result.errors) {
          result.errors = handleErrors(
            result.errors,
            req,
            resForReq.get(req)!, // should be always present
          );
          return result;
        }
      },
    });

    return middleware;
  },
  // TODO: cannot use "postgraphile:http:eventStreamRouteHandler" because watchPg has to be true (https://github.com/graphile/postgraphile/blob/55bff41460b113481c8161ef8f178f5af0a17df3/src/postgraphile/http/createPostGraphileHttpRequestHandler.ts#L548-L553)
  'postgraphile:http:handler'(req, ctx) {
    // TODO: context typings for the hook are incorrect (https://github.com/graphile/postgraphile/blob/55bff41460b113481c8161ef8f178f5af0a17df3/src/postgraphile/http/createPostGraphileHttpRequestHandler.ts#L528-L532)
    const options = ctx.options as CreateRequestHandlerOptions;
    const res = ctx.res as ServerResponse;
    const next = ctx.next as (err?: Error | 'route') => void;

    const url = new URL(req.url || '', `http://${req.headers.host}`);
    if (url.pathname !== eventStreamRoute) {
      return req;
    }

    // receiving a GET request without query params is probably PostGraphile emitting schema changes
    if (
      req.method === 'GET' &&
      !req.headers[TOKEN_HEADER_KEY] &&
      !url.searchParams.has('query')
    ) {
      if (req.headers.accept !== 'text/event-stream') {
        // this conditional is intentionally nested here because "single connection mode" in GraphQL over SSE accepts non-event stream requests
        // for more information, please read: https://github.com/enisdenjo/graphql-sse/blob/master/PROTOCOL.md#single-connection-mode
        res.statusCode = 405;
        res.end();
        next();
        // TODO: wrong typings for the hook. returning a nullish indicates that the hook is taking over
        return null as unknown as IncomingMessage;
      }
      return req;
    }

    if (options.enableCors)
      addCORSHeaders(
        // we use the node response (instead of PostGraphileResponse) because graphql-sse
        // will append more headers down the read and flush them on its own
        res,
      );

    // Just a CORS preflight check
    if (req.method === 'OPTIONS') {
      res.statusCode = 200;
      res.end();
      next();
      // TODO: wrong typings for the hook. returning a nullish indicates that the hook is taking over
      return null as unknown as IncomingMessage;
    }

    resForReq.set(req, res);
    handler(
      req,
      res,
      req.body, // when nullish, `graphql-sse` will read out the body vanilla Node style
    )
      .then(() => {
        next();
      })
      .catch((err) => {
        // handler should throw only on fatal errors
        console.error(err);

        if (!res.headersSent) {
          res.writeHead(500, 'Internal Server Error').end();
        }

        next(err);
      })
      .finally(() => {
        resForReq.delete(req);
      });

    // TODO: wrong typings for the hook. returning a nullish indicates that the hook is taking over
    return null as unknown as IncomingMessage;
  },
};

/**
 * We require the Node response (instead of PostGraphileResponse) because graphql-sse
 * will append more headers down the read and flush them on its own.
 *
 * Mostly copied from https://github.com/graphile/postgraphile/blob/55bff41460b113481c8161ef8f178f5af0a17df3/src/postgraphile/http/createPostGraphileHttpRequestHandler.ts#L1145-L1181
 */
function addCORSHeaders(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // For "single connection mode" GraphQL over SSE
  //   - PUT creates a event stream reservation
  //   - DELETE stops an active subscription in a stream
  res.setHeader('Access-Control-Allow-Methods', 'HEAD, GET, POST, PUT, DELETE');
  res.setHeader(
    'Access-Control-Allow-Headers',
    [
      'Origin',
      'X-Requested-With',
      // Used by `express-graphql` to determine whether to expose the GraphiQL
      // interface (`text/html`) or not.
      'Accept',
      // Used by PostGraphile for auth purposes.
      'Authorization',
      // Used by GraphQL Playground and other Apollo-enabled servers
      'X-Apollo-Tracing',
      // The `Content-*` headers are used when making requests with a body,
      // like in a POST request.
      'Content-Type',
      'Content-Length',
      // For our 'Explain' feature
      'X-PostGraphile-Explain',
      // For "single connection mode" GraphQL over SSE
      TOKEN_HEADER_KEY,
    ].join(', '),
  );
  res.setHeader(
    'Access-Control-Expose-Headers',
    ['X-GraphQL-Event-Stream'].join(', '),
  );
}
