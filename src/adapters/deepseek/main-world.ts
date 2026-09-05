import { installFetchInterceptor } from '../mainWorldCore';

// DeepSeek streams its completion over XMLHttpRequest, not fetch (verified
// live 2026-09-05), which the shared interceptor now also wraps.
installFetchInterceptor(['/api/v0/chat/completion']);
