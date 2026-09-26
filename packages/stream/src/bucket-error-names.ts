/**
 * The error names a log line may carry, and that `createS3ObjectStore` puts in
 * `backup.stream_request_failed`'s `name`. The bucket can supply the name, and the log tail is shown
 * on the unauthenticated recovery page, so a name off these lists becomes
 * {@link UNLISTED_ERROR_NAME}, never the bucket's text.
 *
 * Source: the "Code" list of the `Error` data type in the Amazon S3 API Reference
 * (https://docs.aws.amazon.com/AmazonS3/latest/API/API_Error.html), which says: "The following is a
 * list of Amazon S3 error codes." A name from anywhere else is added by hand, with its source beside
 * it.
 */
const S3_ERROR_NAMES = [
  "AccessDenied",
  "AccountProblem",
  "AllAccessDisabled",
  "AmbiguousGrantByEmailAddress",
  "AuthorizationHeaderMalformed",
  "BadDigest",
  "BucketAlreadyExists",
  "BucketAlreadyOwnedByYou",
  "BucketNotEmpty",
  "CredentialsNotSupported",
  "CrossLocationLoggingProhibited",
  "EntityTooLarge",
  "EntityTooSmall",
  "ExpiredToken",
  "IllegalVersioningConfigurationException",
  "IncompleteBody",
  "IncorrectNumberOfFilesInPostRequest",
  "InlineDataTooLarge",
  "InternalError",
  "InvalidAccessKeyId",
  "InvalidAddressingHeader",
  "InvalidArgument",
  "InvalidBucketName",
  "InvalidBucketState",
  "InvalidDigest",
  "InvalidEncryptionAlgorithmError",
  "InvalidLocationConstraint",
  "InvalidObjectState",
  "InvalidPart",
  "InvalidPartOrder",
  "InvalidPayer",
  "InvalidPolicyDocument",
  "InvalidRange",
  "InvalidRequest",
  "InvalidSOAPRequest",
  "InvalidSecurity",
  "InvalidStorageClass",
  "InvalidTargetBucketForLogging",
  "InvalidToken",
  "InvalidURI",
  "KeyTooLongError",
  "MalformedACLError",
  "MalformedPOSTRequest",
  "MalformedXML",
  "MaxMessageLengthExceeded",
  "MaxPostPreDataLengthExceededError",
  "MetadataTooLarge",
  "MethodNotAllowed",
  "MissingAttachment",
  "MissingContentLength",
  "MissingRequestBodyError",
  "MissingSecurityElement",
  "MissingSecurityHeader",
  "NoLoggingStatusForKey",
  "NoSuchBucket",
  "NoSuchBucketPolicy",
  "NoSuchKey",
  "NoSuchLifecycleConfiguration",
  "NoSuchUpload",
  "NoSuchVersion",
  "NotImplemented",
  "NotSignedUp",
  "OperationAborted",
  "PermanentRedirect",
  "PreconditionFailed",
  "Redirect",
  "RequestIsNotMultiPartContent",
  "RequestTimeTooSkewed",
  "RequestTimeout",
  "RequestTorrentOfBucketError",
  "RestoreAlreadyInProgress",
  "ServiceUnavailable",
  "SignatureDoesNotMatch",
  "SlowDown",
  "TemporaryRedirect",
  "TokenRefreshRequired",
  "TooManyBuckets",
  "UnexpectedContent",
  "UnresolvableGrantByEmailAddress",
  "UserKeyMustBeSpecified",
  // Not in that list: the PutObject page says "If a conflicting operation occurs during the upload
  // S3 returns a 409 ConditionalRequestConflict response"
  // (https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html).
  "ConditionalRequestConflict",
] as const;

/** The names `s3-store.ts` gives an answer it refused. */
export const ANSWER_REFUSALS = [
  "IncompleteDeleteResult",
  "IncompleteListing",
  "IncompleteResponse",
  "MissingContinuationToken",
  "MissingETag",
  "RepeatedContinuationToken",
] as const;

export type AnswerRefusal = (typeof ANSWER_REFUSALS)[number];

/**
 * Fixed names the client gives a failure that carries no bucket error code:
 * `@smithy/node-http-handler` (4.12.1, `dist-cjs/index.js`) names a request that timed out, or whose
 * connection was reset, `TimeoutError`, and passes any other request error, such as a refused
 * connection, on as Node's plain `Error`. A bucket can also send either word as its code; being
 * fixed words, they carry none of its text.
 */
const CLIENT_ERROR_NAMES = ["Error", "TimeoutError"] as const;

export const UNLISTED_ERROR_NAME = "other";

const LISTED: ReadonlySet<string> = new Set<string>([
  ...S3_ERROR_NAMES,
  ...ANSWER_REFUSALS,
  ...CLIENT_ERROR_NAMES,
]);

export function loggableErrorName(name: string): string {
  return LISTED.has(name) ? name : UNLISTED_ERROR_NAME;
}
