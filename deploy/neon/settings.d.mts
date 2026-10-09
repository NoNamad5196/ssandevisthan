export type PublicSettings=Record<'PUBLIC_API_URL'|'CORS_ORIGINS'|'OPENAI_MODEL'|'NORMALIZER_VERSION'|'NORMALIZER_VERIFIED'|'EGRESS_VERIFIED'|'INPUT_BUCKET'|'PAID_EXECUTION_ENABLED'|'VERIFIED_CLIENT_IP_HEADER',string>;
export type BackendSettings=PublicSettings&Record<'AUTH_JWT_SECRET_BASE64'|'INTERNAL_WORKER_SECRET'|'SCHEDULE_PATH_TOKEN',string>&{OPENAI_API_KEY?:string};
export declare const publicSettingKeys:readonly (keyof PublicSettings)[];
export declare const requiredSecretReferences:readonly string[];
export declare function validatePublicDeploymentSettings(value:unknown):PublicSettings;
export declare function validateBackendSettings(value:unknown):BackendSettings;
export declare function publicDeploymentSettings(value:unknown):PublicSettings;
