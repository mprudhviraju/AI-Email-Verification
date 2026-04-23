import { gql } from '@apollo/client';
import * as Apollo from '@apollo/client';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
const defaultOptions = {} as const;
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
};

/**
 * A programmatic API key for authenticating requests without a JWT.
 * Send as the `X-API-Key` header. Daily usage is capped at `dailyLimit`.
 */
export type ApiKey = {
  __typename?: 'ApiKey';
  createdAt: Scalars['String']['output'];
  dailyLimit: Scalars['Int']['output'];
  id: Scalars['ID']['output'];
  isActive: Scalars['Boolean']['output'];
  /** First 8 characters of the key — safe to display, not usable alone. */
  keyPrefix: Scalars['String']['output'];
  lastUsedAt?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
};

export type AuthPayload = {
  __typename?: 'AuthPayload';
  token: Scalars['String']['output'];
  user: User;
};

export enum BatchStatus {
  Done = 'DONE',
  Failed = 'FAILED',
  Pending = 'PENDING',
  Running = 'RUNNING'
}

/** Returned once on key creation. `key` is the raw key — store it securely. */
export type CreateApiKeyPayload = {
  __typename?: 'CreateApiKeyPayload';
  apiKey: ApiKey;
  /** The raw API key. Shown ONCE and never retrievable again. */
  key: Scalars['String']['output'];
};

export type EmailVerificationBatch = {
  __typename?: 'EmailVerificationBatch';
  completedAt?: Maybe<Scalars['String']['output']>;
  completedCount: Scalars['Int']['output'];
  createdAt: Scalars['String']['output'];
  currentStage?: Maybe<Scalars['String']['output']>;
  dnsDone: Scalars['Int']['output'];
  enrichmentDone: Scalars['Int']['output'];
  id: Scalars['ID']['output'];
  invalidCount: Scalars['Int']['output'];
  invalidPct: Scalars['Float']['output'];
  jobId?: Maybe<Scalars['ID']['output']>;
  label: Scalars['String']['output'];
  results: Array<EmailVerificationResult>;
  riskyCount: Scalars['Int']['output'];
  riskyPct: Scalars['Float']['output'];
  smtpDone: Scalars['Int']['output'];
  status: BatchStatus;
  syntaxDone: Scalars['Int']['output'];
  totalCount: Scalars['Int']['output'];
  unknownCount: Scalars['Int']['output'];
  unknownPct: Scalars['Float']['output'];
  validCount: Scalars['Int']['output'];
  validPct: Scalars['Float']['output'];
};

export type EmailVerificationResult = {
  __typename?: 'EmailVerificationResult';
  batchId: Scalars['ID']['output'];
  confidence: VerificationConfidence;
  dnsResponseMs?: Maybe<Scalars['Int']['output']>;
  dnsTtl?: Maybe<Scalars['Int']['output']>;
  domain: Scalars['String']['output'];
  email: Scalars['String']['output'];
  errorMessage?: Maybe<Scalars['String']['output']>;
  gravatarFound: Scalars['Boolean']['output'];
  hibpBreachCount: Scalars['Int']['output'];
  id: Scalars['ID']['output'];
  isCatchAll: Scalars['Boolean']['output'];
  isDisposable: Scalars['Boolean']['output'];
  isHoneypot: Scalars['Boolean']['output'];
  isRoleBased: Scalars['Boolean']['output'];
  isUnicode: Scalars['Boolean']['output'];
  mxFallback: Scalars['Boolean']['output'];
  mxFound: Scalars['Boolean']['output'];
  mxHost?: Maybe<Scalars['String']['output']>;
  responseTimeMs?: Maybe<Scalars['Int']['output']>;
  score: Scalars['Int']['output'];
  smtpCode?: Maybe<Scalars['Int']['output']>;
  smtpMessage?: Maybe<Scalars['String']['output']>;
  smtpReachable: Scalars['Boolean']['output'];
  status: EmailVerificationStatus;
  syntaxValid: Scalars['Boolean']['output'];
  verifiedAt: Scalars['String']['output'];
};

export type EmailVerificationResultsPage = {
  __typename?: 'EmailVerificationResultsPage';
  hasMore: Scalars['Boolean']['output'];
  nextCursor?: Maybe<Scalars['ID']['output']>;
  results: Array<EmailVerificationResult>;
  total: Scalars['Int']['output'];
};

export enum EmailVerificationStatus {
  CatchAll = 'CATCH_ALL',
  Disposable = 'DISPOSABLE',
  Invalid = 'INVALID',
  Risky = 'RISKY',
  RoleBased = 'ROLE_BASED',
  Unknown = 'UNKNOWN',
  Valid = 'VALID'
}

export type Job = {
  __typename?: 'Job';
  createdAt: Scalars['String']['output'];
  error?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  status: JobStatus;
  updatedAt: Scalars['String']['output'];
};

export enum JobStatus {
  Done = 'DONE',
  Failed = 'FAILED',
  Pending = 'PENDING',
  Running = 'RUNNING'
}

export type Mutation = {
  __typename?: 'Mutation';
  /** Create a new API key. Returns the raw key once — it cannot be retrieved again. */
  createApiKey: CreateApiKeyPayload;
  createVerificationBatch: EmailVerificationBatch;
  deleteVerificationBatch: Scalars['Boolean']['output'];
  login: AuthPayload;
  register: AuthPayload;
  retryVerificationBatch: EmailVerificationBatch;
  /** Deactivate an API key. It will immediately stop working. */
  revokeApiKey: Scalars['Boolean']['output'];
  verifySingleEmail: EmailVerificationResult;
};


export type MutationCreateApiKeyArgs = {
  dailyLimit?: InputMaybe<Scalars['Int']['input']>;
  name: Scalars['String']['input'];
};


export type MutationCreateVerificationBatchArgs = {
  csvContent: Scalars['String']['input'];
  label: Scalars['String']['input'];
};


export type MutationDeleteVerificationBatchArgs = {
  id: Scalars['ID']['input'];
};


export type MutationLoginArgs = {
  email: Scalars['String']['input'];
  password: Scalars['String']['input'];
};


export type MutationRegisterArgs = {
  email: Scalars['String']['input'];
  password: Scalars['String']['input'];
};


export type MutationRetryVerificationBatchArgs = {
  id: Scalars['ID']['input'];
};


export type MutationRevokeApiKeyArgs = {
  id: Scalars['ID']['input'];
};


export type MutationVerifySingleEmailArgs = {
  email: Scalars['String']['input'];
};

export type Query = {
  __typename?: 'Query';
  emailVerificationBatch?: Maybe<EmailVerificationBatch>;
  emailVerificationBatches: Array<EmailVerificationBatch>;
  emailVerificationResults: EmailVerificationResultsPage;
  me?: Maybe<User>;
  /** List all API keys belonging to the authenticated user. */
  myApiKeys: Array<ApiKey>;
};


export type QueryEmailVerificationBatchArgs = {
  id: Scalars['ID']['input'];
};


export type QueryEmailVerificationBatchesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryEmailVerificationResultsArgs = {
  batchId: Scalars['ID']['input'];
  cursor?: InputMaybe<Scalars['ID']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  search?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<EmailVerificationStatus>;
};

export type Subscription = {
  __typename?: 'Subscription';
  jobUpdated: Job;
};


export type SubscriptionJobUpdatedArgs = {
  batchId: Scalars['ID']['input'];
};

export type User = {
  __typename?: 'User';
  createdAt: Scalars['String']['output'];
  email: Scalars['String']['output'];
  id: Scalars['ID']['output'];
};

export enum VerificationConfidence {
  High = 'HIGH',
  Low = 'LOW',
  Medium = 'MEDIUM'
}

export type VerifySingleEmailMutationVariables = Exact<{
  email: Scalars['String']['input'];
}>;


export type VerifySingleEmailMutation = { __typename?: 'Mutation', verifySingleEmail: { __typename?: 'EmailVerificationResult', id: string, batchId: string, email: string, domain: string, syntaxValid: boolean, isDisposable: boolean, isRoleBased: boolean, isUnicode: boolean, isHoneypot: boolean, mxFound: boolean, mxHost?: string | null, mxFallback: boolean, smtpReachable: boolean, smtpCode?: number | null, smtpMessage?: string | null, isCatchAll: boolean, gravatarFound: boolean, hibpBreachCount: number, status: EmailVerificationStatus, score: number, confidence: VerificationConfidence, verifiedAt: string, responseTimeMs?: number | null, errorMessage?: string | null } };

export type CreateVerificationBatchMutationVariables = Exact<{
  label: Scalars['String']['input'];
  csvContent: Scalars['String']['input'];
}>;


export type CreateVerificationBatchMutation = { __typename?: 'Mutation', createVerificationBatch: { __typename?: 'EmailVerificationBatch', id: string, label: string, status: BatchStatus, totalCount: number, completedCount: number, validCount: number, invalidCount: number, riskyCount: number, unknownCount: number, createdAt: string, jobId?: string | null } };

export type RetryVerificationBatchMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type RetryVerificationBatchMutation = { __typename?: 'Mutation', retryVerificationBatch: { __typename?: 'EmailVerificationBatch', id: string, status: BatchStatus, completedCount: number, totalCount: number } };

export type DeleteVerificationBatchMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteVerificationBatchMutation = { __typename?: 'Mutation', deleteVerificationBatch: boolean };

export type EmailVerificationBatchesQueryVariables = Exact<{
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
}>;


export type EmailVerificationBatchesQuery = { __typename?: 'Query', emailVerificationBatches: Array<{ __typename?: 'EmailVerificationBatch', id: string, label: string, status: BatchStatus, totalCount: number, completedCount: number, validCount: number, invalidCount: number, riskyCount: number, unknownCount: number, validPct: number, invalidPct: number, riskyPct: number, unknownPct: number, createdAt: string, completedAt?: string | null }> };

export type EmailVerificationBatchQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type EmailVerificationBatchQuery = { __typename?: 'Query', emailVerificationBatch?: { __typename?: 'EmailVerificationBatch', id: string, label: string, status: BatchStatus, currentStage?: string | null, totalCount: number, completedCount: number, validCount: number, invalidCount: number, riskyCount: number, unknownCount: number, syntaxDone: number, dnsDone: number, smtpDone: number, enrichmentDone: number, validPct: number, invalidPct: number, riskyPct: number, unknownPct: number, createdAt: string, completedAt?: string | null, jobId?: string | null } | null };

export type EmailVerificationResultsQueryVariables = Exact<{
  batchId: Scalars['ID']['input'];
  status?: InputMaybe<EmailVerificationStatus>;
  search?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
}>;


export type EmailVerificationResultsQuery = { __typename?: 'Query', emailVerificationResults: { __typename?: 'EmailVerificationResultsPage', total: number, results: Array<{ __typename?: 'EmailVerificationResult', id: string, email: string, domain: string, status: EmailVerificationStatus, score: number, confidence: VerificationConfidence, mxFound: boolean, mxHost?: string | null, smtpReachable: boolean, smtpCode?: number | null, isDisposable: boolean, isRoleBased: boolean, isCatchAll: boolean, gravatarFound: boolean, hibpBreachCount: number, isHoneypot: boolean, verifiedAt: string, responseTimeMs?: number | null, errorMessage?: string | null }> } };

export type MeQueryVariables = Exact<{ [key: string]: never; }>;


export type MeQuery = { __typename?: 'Query', me?: { __typename?: 'User', id: string, email: string } | null };

export type RegisterMutationVariables = Exact<{
  email: Scalars['String']['input'];
  password: Scalars['String']['input'];
}>;


export type RegisterMutation = { __typename?: 'Mutation', register: { __typename?: 'AuthPayload', token: string, user: { __typename?: 'User', id: string, email: string } } };

export type LoginMutationVariables = Exact<{
  email: Scalars['String']['input'];
  password: Scalars['String']['input'];
}>;


export type LoginMutation = { __typename?: 'Mutation', login: { __typename?: 'AuthPayload', token: string, user: { __typename?: 'User', id: string, email: string } } };

export type JobUpdatedSubscriptionVariables = Exact<{
  batchId: Scalars['ID']['input'];
}>;


export type JobUpdatedSubscription = { __typename?: 'Subscription', jobUpdated: { __typename?: 'Job', id: string, status: JobStatus, error?: string | null, updatedAt: string } };


export const VerifySingleEmailDocument = gql`
    mutation VerifySingleEmail($email: String!) {
  verifySingleEmail(email: $email) {
    id
    batchId
    email
    domain
    syntaxValid
    isDisposable
    isRoleBased
    isUnicode
    isHoneypot
    mxFound
    mxHost
    mxFallback
    smtpReachable
    smtpCode
    smtpMessage
    isCatchAll
    gravatarFound
    hibpBreachCount
    status
    score
    confidence
    verifiedAt
    responseTimeMs
    errorMessage
  }
}
    `;
export type VerifySingleEmailMutationFn = Apollo.MutationFunction<VerifySingleEmailMutation, VerifySingleEmailMutationVariables>;

/**
 * __useVerifySingleEmailMutation__
 *
 * To run a mutation, you first call `useVerifySingleEmailMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useVerifySingleEmailMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [verifySingleEmailMutation, { data, loading, error }] = useVerifySingleEmailMutation({
 *   variables: {
 *      email: // value for 'email'
 *   },
 * });
 */
export function useVerifySingleEmailMutation(baseOptions?: Apollo.MutationHookOptions<VerifySingleEmailMutation, VerifySingleEmailMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<VerifySingleEmailMutation, VerifySingleEmailMutationVariables>(VerifySingleEmailDocument, options);
      }
export type VerifySingleEmailMutationHookResult = ReturnType<typeof useVerifySingleEmailMutation>;
export type VerifySingleEmailMutationResult = Apollo.MutationResult<VerifySingleEmailMutation>;
export type VerifySingleEmailMutationOptions = Apollo.BaseMutationOptions<VerifySingleEmailMutation, VerifySingleEmailMutationVariables>;
export const CreateVerificationBatchDocument = gql`
    mutation CreateVerificationBatch($label: String!, $csvContent: String!) {
  createVerificationBatch(label: $label, csvContent: $csvContent) {
    id
    label
    status
    totalCount
    completedCount
    validCount
    invalidCount
    riskyCount
    unknownCount
    createdAt
    jobId
  }
}
    `;
export type CreateVerificationBatchMutationFn = Apollo.MutationFunction<CreateVerificationBatchMutation, CreateVerificationBatchMutationVariables>;

/**
 * __useCreateVerificationBatchMutation__
 *
 * To run a mutation, you first call `useCreateVerificationBatchMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useCreateVerificationBatchMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [createVerificationBatchMutation, { data, loading, error }] = useCreateVerificationBatchMutation({
 *   variables: {
 *      label: // value for 'label'
 *      csvContent: // value for 'csvContent'
 *   },
 * });
 */
export function useCreateVerificationBatchMutation(baseOptions?: Apollo.MutationHookOptions<CreateVerificationBatchMutation, CreateVerificationBatchMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<CreateVerificationBatchMutation, CreateVerificationBatchMutationVariables>(CreateVerificationBatchDocument, options);
      }
export type CreateVerificationBatchMutationHookResult = ReturnType<typeof useCreateVerificationBatchMutation>;
export type CreateVerificationBatchMutationResult = Apollo.MutationResult<CreateVerificationBatchMutation>;
export type CreateVerificationBatchMutationOptions = Apollo.BaseMutationOptions<CreateVerificationBatchMutation, CreateVerificationBatchMutationVariables>;
export const RetryVerificationBatchDocument = gql`
    mutation RetryVerificationBatch($id: ID!) {
  retryVerificationBatch(id: $id) {
    id
    status
    completedCount
    totalCount
  }
}
    `;
export type RetryVerificationBatchMutationFn = Apollo.MutationFunction<RetryVerificationBatchMutation, RetryVerificationBatchMutationVariables>;

/**
 * __useRetryVerificationBatchMutation__
 *
 * To run a mutation, you first call `useRetryVerificationBatchMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useRetryVerificationBatchMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [retryVerificationBatchMutation, { data, loading, error }] = useRetryVerificationBatchMutation({
 *   variables: {
 *      id: // value for 'id'
 *   },
 * });
 */
export function useRetryVerificationBatchMutation(baseOptions?: Apollo.MutationHookOptions<RetryVerificationBatchMutation, RetryVerificationBatchMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<RetryVerificationBatchMutation, RetryVerificationBatchMutationVariables>(RetryVerificationBatchDocument, options);
      }
export type RetryVerificationBatchMutationHookResult = ReturnType<typeof useRetryVerificationBatchMutation>;
export type RetryVerificationBatchMutationResult = Apollo.MutationResult<RetryVerificationBatchMutation>;
export type RetryVerificationBatchMutationOptions = Apollo.BaseMutationOptions<RetryVerificationBatchMutation, RetryVerificationBatchMutationVariables>;
export const DeleteVerificationBatchDocument = gql`
    mutation DeleteVerificationBatch($id: ID!) {
  deleteVerificationBatch(id: $id)
}
    `;
export type DeleteVerificationBatchMutationFn = Apollo.MutationFunction<DeleteVerificationBatchMutation, DeleteVerificationBatchMutationVariables>;

/**
 * __useDeleteVerificationBatchMutation__
 *
 * To run a mutation, you first call `useDeleteVerificationBatchMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useDeleteVerificationBatchMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [deleteVerificationBatchMutation, { data, loading, error }] = useDeleteVerificationBatchMutation({
 *   variables: {
 *      id: // value for 'id'
 *   },
 * });
 */
export function useDeleteVerificationBatchMutation(baseOptions?: Apollo.MutationHookOptions<DeleteVerificationBatchMutation, DeleteVerificationBatchMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<DeleteVerificationBatchMutation, DeleteVerificationBatchMutationVariables>(DeleteVerificationBatchDocument, options);
      }
export type DeleteVerificationBatchMutationHookResult = ReturnType<typeof useDeleteVerificationBatchMutation>;
export type DeleteVerificationBatchMutationResult = Apollo.MutationResult<DeleteVerificationBatchMutation>;
export type DeleteVerificationBatchMutationOptions = Apollo.BaseMutationOptions<DeleteVerificationBatchMutation, DeleteVerificationBatchMutationVariables>;
export const EmailVerificationBatchesDocument = gql`
    query EmailVerificationBatches($limit: Int, $offset: Int) {
  emailVerificationBatches(limit: $limit, offset: $offset) {
    id
    label
    status
    totalCount
    completedCount
    validCount
    invalidCount
    riskyCount
    unknownCount
    validPct
    invalidPct
    riskyPct
    unknownPct
    createdAt
    completedAt
  }
}
    `;

/**
 * __useEmailVerificationBatchesQuery__
 *
 * To run a query within a React component, call `useEmailVerificationBatchesQuery` and pass it any options that fit your needs.
 * When your component renders, `useEmailVerificationBatchesQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useEmailVerificationBatchesQuery({
 *   variables: {
 *      limit: // value for 'limit'
 *      offset: // value for 'offset'
 *   },
 * });
 */
export function useEmailVerificationBatchesQuery(baseOptions?: Apollo.QueryHookOptions<EmailVerificationBatchesQuery, EmailVerificationBatchesQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<EmailVerificationBatchesQuery, EmailVerificationBatchesQueryVariables>(EmailVerificationBatchesDocument, options);
      }
export function useEmailVerificationBatchesLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<EmailVerificationBatchesQuery, EmailVerificationBatchesQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<EmailVerificationBatchesQuery, EmailVerificationBatchesQueryVariables>(EmailVerificationBatchesDocument, options);
        }
// @ts-ignore
export function useEmailVerificationBatchesSuspenseQuery(baseOptions?: Apollo.SuspenseQueryHookOptions<EmailVerificationBatchesQuery, EmailVerificationBatchesQueryVariables>): Apollo.UseSuspenseQueryResult<EmailVerificationBatchesQuery, EmailVerificationBatchesQueryVariables>;
export function useEmailVerificationBatchesSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<EmailVerificationBatchesQuery, EmailVerificationBatchesQueryVariables>): Apollo.UseSuspenseQueryResult<EmailVerificationBatchesQuery | undefined, EmailVerificationBatchesQueryVariables>;
export function useEmailVerificationBatchesSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<EmailVerificationBatchesQuery, EmailVerificationBatchesQueryVariables>) {
          const options = baseOptions === Apollo.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return Apollo.useSuspenseQuery<EmailVerificationBatchesQuery, EmailVerificationBatchesQueryVariables>(EmailVerificationBatchesDocument, options);
        }
export type EmailVerificationBatchesQueryHookResult = ReturnType<typeof useEmailVerificationBatchesQuery>;
export type EmailVerificationBatchesLazyQueryHookResult = ReturnType<typeof useEmailVerificationBatchesLazyQuery>;
export type EmailVerificationBatchesSuspenseQueryHookResult = ReturnType<typeof useEmailVerificationBatchesSuspenseQuery>;
export type EmailVerificationBatchesQueryResult = Apollo.QueryResult<EmailVerificationBatchesQuery, EmailVerificationBatchesQueryVariables>;
export const EmailVerificationBatchDocument = gql`
    query EmailVerificationBatch($id: ID!) {
  emailVerificationBatch(id: $id) {
    id
    label
    status
    currentStage
    totalCount
    completedCount
    validCount
    invalidCount
    riskyCount
    unknownCount
    syntaxDone
    dnsDone
    smtpDone
    enrichmentDone
    validPct
    invalidPct
    riskyPct
    unknownPct
    createdAt
    completedAt
    jobId
  }
}
    `;

/**
 * __useEmailVerificationBatchQuery__
 *
 * To run a query within a React component, call `useEmailVerificationBatchQuery` and pass it any options that fit your needs.
 * When your component renders, `useEmailVerificationBatchQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useEmailVerificationBatchQuery({
 *   variables: {
 *      id: // value for 'id'
 *   },
 * });
 */
export function useEmailVerificationBatchQuery(baseOptions: Apollo.QueryHookOptions<EmailVerificationBatchQuery, EmailVerificationBatchQueryVariables> & ({ variables: EmailVerificationBatchQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<EmailVerificationBatchQuery, EmailVerificationBatchQueryVariables>(EmailVerificationBatchDocument, options);
      }
export function useEmailVerificationBatchLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<EmailVerificationBatchQuery, EmailVerificationBatchQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<EmailVerificationBatchQuery, EmailVerificationBatchQueryVariables>(EmailVerificationBatchDocument, options);
        }
// @ts-ignore
export function useEmailVerificationBatchSuspenseQuery(baseOptions?: Apollo.SuspenseQueryHookOptions<EmailVerificationBatchQuery, EmailVerificationBatchQueryVariables>): Apollo.UseSuspenseQueryResult<EmailVerificationBatchQuery, EmailVerificationBatchQueryVariables>;
export function useEmailVerificationBatchSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<EmailVerificationBatchQuery, EmailVerificationBatchQueryVariables>): Apollo.UseSuspenseQueryResult<EmailVerificationBatchQuery | undefined, EmailVerificationBatchQueryVariables>;
export function useEmailVerificationBatchSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<EmailVerificationBatchQuery, EmailVerificationBatchQueryVariables>) {
          const options = baseOptions === Apollo.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return Apollo.useSuspenseQuery<EmailVerificationBatchQuery, EmailVerificationBatchQueryVariables>(EmailVerificationBatchDocument, options);
        }
export type EmailVerificationBatchQueryHookResult = ReturnType<typeof useEmailVerificationBatchQuery>;
export type EmailVerificationBatchLazyQueryHookResult = ReturnType<typeof useEmailVerificationBatchLazyQuery>;
export type EmailVerificationBatchSuspenseQueryHookResult = ReturnType<typeof useEmailVerificationBatchSuspenseQuery>;
export type EmailVerificationBatchQueryResult = Apollo.QueryResult<EmailVerificationBatchQuery, EmailVerificationBatchQueryVariables>;
export const EmailVerificationResultsDocument = gql`
    query EmailVerificationResults($batchId: ID!, $status: EmailVerificationStatus, $search: String, $limit: Int, $offset: Int) {
  emailVerificationResults(
    batchId: $batchId
    status: $status
    search: $search
    limit: $limit
    offset: $offset
  ) {
    total
    results {
      id
      email
      domain
      status
      score
      confidence
      mxFound
      mxHost
      smtpReachable
      smtpCode
      isDisposable
      isRoleBased
      isCatchAll
      gravatarFound
      hibpBreachCount
      isHoneypot
      verifiedAt
      responseTimeMs
      errorMessage
    }
  }
}
    `;

/**
 * __useEmailVerificationResultsQuery__
 *
 * To run a query within a React component, call `useEmailVerificationResultsQuery` and pass it any options that fit your needs.
 * When your component renders, `useEmailVerificationResultsQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useEmailVerificationResultsQuery({
 *   variables: {
 *      batchId: // value for 'batchId'
 *      status: // value for 'status'
 *      search: // value for 'search'
 *      limit: // value for 'limit'
 *      offset: // value for 'offset'
 *   },
 * });
 */
export function useEmailVerificationResultsQuery(baseOptions: Apollo.QueryHookOptions<EmailVerificationResultsQuery, EmailVerificationResultsQueryVariables> & ({ variables: EmailVerificationResultsQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<EmailVerificationResultsQuery, EmailVerificationResultsQueryVariables>(EmailVerificationResultsDocument, options);
      }
export function useEmailVerificationResultsLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<EmailVerificationResultsQuery, EmailVerificationResultsQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<EmailVerificationResultsQuery, EmailVerificationResultsQueryVariables>(EmailVerificationResultsDocument, options);
        }
// @ts-ignore
export function useEmailVerificationResultsSuspenseQuery(baseOptions?: Apollo.SuspenseQueryHookOptions<EmailVerificationResultsQuery, EmailVerificationResultsQueryVariables>): Apollo.UseSuspenseQueryResult<EmailVerificationResultsQuery, EmailVerificationResultsQueryVariables>;
export function useEmailVerificationResultsSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<EmailVerificationResultsQuery, EmailVerificationResultsQueryVariables>): Apollo.UseSuspenseQueryResult<EmailVerificationResultsQuery | undefined, EmailVerificationResultsQueryVariables>;
export function useEmailVerificationResultsSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<EmailVerificationResultsQuery, EmailVerificationResultsQueryVariables>) {
          const options = baseOptions === Apollo.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return Apollo.useSuspenseQuery<EmailVerificationResultsQuery, EmailVerificationResultsQueryVariables>(EmailVerificationResultsDocument, options);
        }
export type EmailVerificationResultsQueryHookResult = ReturnType<typeof useEmailVerificationResultsQuery>;
export type EmailVerificationResultsLazyQueryHookResult = ReturnType<typeof useEmailVerificationResultsLazyQuery>;
export type EmailVerificationResultsSuspenseQueryHookResult = ReturnType<typeof useEmailVerificationResultsSuspenseQuery>;
export type EmailVerificationResultsQueryResult = Apollo.QueryResult<EmailVerificationResultsQuery, EmailVerificationResultsQueryVariables>;
export const MeDocument = gql`
    query Me {
  me {
    id
    email
  }
}
    `;

/**
 * __useMeQuery__
 *
 * To run a query within a React component, call `useMeQuery` and pass it any options that fit your needs.
 * When your component renders, `useMeQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useMeQuery({
 *   variables: {
 *   },
 * });
 */
export function useMeQuery(baseOptions?: Apollo.QueryHookOptions<MeQuery, MeQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<MeQuery, MeQueryVariables>(MeDocument, options);
      }
export function useMeLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<MeQuery, MeQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<MeQuery, MeQueryVariables>(MeDocument, options);
        }
// @ts-ignore
export function useMeSuspenseQuery(baseOptions?: Apollo.SuspenseQueryHookOptions<MeQuery, MeQueryVariables>): Apollo.UseSuspenseQueryResult<MeQuery, MeQueryVariables>;
export function useMeSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<MeQuery, MeQueryVariables>): Apollo.UseSuspenseQueryResult<MeQuery | undefined, MeQueryVariables>;
export function useMeSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<MeQuery, MeQueryVariables>) {
          const options = baseOptions === Apollo.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return Apollo.useSuspenseQuery<MeQuery, MeQueryVariables>(MeDocument, options);
        }
export type MeQueryHookResult = ReturnType<typeof useMeQuery>;
export type MeLazyQueryHookResult = ReturnType<typeof useMeLazyQuery>;
export type MeSuspenseQueryHookResult = ReturnType<typeof useMeSuspenseQuery>;
export type MeQueryResult = Apollo.QueryResult<MeQuery, MeQueryVariables>;
export const RegisterDocument = gql`
    mutation Register($email: String!, $password: String!) {
  register(email: $email, password: $password) {
    token
    user {
      id
      email
    }
  }
}
    `;
export type RegisterMutationFn = Apollo.MutationFunction<RegisterMutation, RegisterMutationVariables>;

/**
 * __useRegisterMutation__
 *
 * To run a mutation, you first call `useRegisterMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useRegisterMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [registerMutation, { data, loading, error }] = useRegisterMutation({
 *   variables: {
 *      email: // value for 'email'
 *      password: // value for 'password'
 *   },
 * });
 */
export function useRegisterMutation(baseOptions?: Apollo.MutationHookOptions<RegisterMutation, RegisterMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<RegisterMutation, RegisterMutationVariables>(RegisterDocument, options);
      }
export type RegisterMutationHookResult = ReturnType<typeof useRegisterMutation>;
export type RegisterMutationResult = Apollo.MutationResult<RegisterMutation>;
export type RegisterMutationOptions = Apollo.BaseMutationOptions<RegisterMutation, RegisterMutationVariables>;
export const LoginDocument = gql`
    mutation Login($email: String!, $password: String!) {
  login(email: $email, password: $password) {
    token
    user {
      id
      email
    }
  }
}
    `;
export type LoginMutationFn = Apollo.MutationFunction<LoginMutation, LoginMutationVariables>;

/**
 * __useLoginMutation__
 *
 * To run a mutation, you first call `useLoginMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useLoginMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [loginMutation, { data, loading, error }] = useLoginMutation({
 *   variables: {
 *      email: // value for 'email'
 *      password: // value for 'password'
 *   },
 * });
 */
export function useLoginMutation(baseOptions?: Apollo.MutationHookOptions<LoginMutation, LoginMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<LoginMutation, LoginMutationVariables>(LoginDocument, options);
      }
export type LoginMutationHookResult = ReturnType<typeof useLoginMutation>;
export type LoginMutationResult = Apollo.MutationResult<LoginMutation>;
export type LoginMutationOptions = Apollo.BaseMutationOptions<LoginMutation, LoginMutationVariables>;
export const JobUpdatedDocument = gql`
    subscription JobUpdated($batchId: ID!) {
  jobUpdated(batchId: $batchId) {
    id
    status
    error
    updatedAt
  }
}
    `;

/**
 * __useJobUpdatedSubscription__
 *
 * To run a query within a React component, call `useJobUpdatedSubscription` and pass it any options that fit your needs.
 * When your component renders, `useJobUpdatedSubscription` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the subscription, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useJobUpdatedSubscription({
 *   variables: {
 *      batchId: // value for 'batchId'
 *   },
 * });
 */
export function useJobUpdatedSubscription(baseOptions: Apollo.SubscriptionHookOptions<JobUpdatedSubscription, JobUpdatedSubscriptionVariables> & ({ variables: JobUpdatedSubscriptionVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useSubscription<JobUpdatedSubscription, JobUpdatedSubscriptionVariables>(JobUpdatedDocument, options);
      }
export type JobUpdatedSubscriptionHookResult = ReturnType<typeof useJobUpdatedSubscription>;
export type JobUpdatedSubscriptionResult = Apollo.SubscriptionResult<JobUpdatedSubscription>;