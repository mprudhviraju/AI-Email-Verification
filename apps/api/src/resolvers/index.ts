import { authResolvers } from './auth.resolver.js';
import { verificationResolvers } from './verification.resolver.js';
import { apiKeyResolvers } from './api-key.resolver.js';

export const resolvers = {
  Query: {
    ...authResolvers.Query,
    ...verificationResolvers.Query,
    ...apiKeyResolvers.Query,
  },
  Mutation: {
    ...authResolvers.Mutation,
    ...verificationResolvers.Mutation,
    ...apiKeyResolvers.Mutation,
  },
  Subscription: verificationResolvers.Subscription,
  User:                    authResolvers.User,
  EmailVerificationBatch:  verificationResolvers.EmailVerificationBatch,
  ApiKey:                  apiKeyResolvers.ApiKey,
};
