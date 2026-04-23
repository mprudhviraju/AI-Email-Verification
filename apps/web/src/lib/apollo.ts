import {
  ApolloClient,
  InMemoryCache,
  createHttpLink,
  split,
} from '@apollo/client';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { getMainDefinition } from '@apollo/client/utilities';
import { createClient } from 'graphql-ws';
import { setContext } from '@apollo/client/link/context';

// F2: VITE_API_URL points to the deployed API (e.g. https://api.yourdomain.com).
// When empty (local dev), relative paths are used and Vite's dev proxy handles
// routing to localhost:4001 — no change to the local dev workflow.
const API_URL = import.meta.env.VITE_API_URL ?? '';

const httpLink = createHttpLink({
  uri: API_URL ? `${API_URL}/graphql` : '/graphql',
});

const authLink = setContext((_, { headers }) => {
  const token = localStorage.getItem('auth_token');
  return {
    headers: {
      ...headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
});

// WebSocket URL: derive from VITE_API_URL (production) or current page host (dev proxy).
const wsBase = API_URL
  ? API_URL.replace(/^https/, 'wss').replace(/^http/, 'ws')
  : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`;

const wsLink = new GraphQLWsLink(
  createClient({
    url: `${wsBase}/graphql`,
    connectionParams: () => {
      const token = localStorage.getItem('auth_token');
      return token ? { Authorization: `Bearer ${token}` } : {};
    },
  }),
);

const splitLink = split(
  ({ query }) => {
    const def = getMainDefinition(query);
    return def.kind === 'OperationDefinition' && def.operation === 'subscription';
  },
  wsLink,
  authLink.concat(httpLink),
);

export const apolloClient = new ApolloClient({
  link: splitLink,
  cache: new InMemoryCache(),
});
