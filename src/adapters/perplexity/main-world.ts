import { installFetchInterceptor } from '../mainWorldCore';

// Patterns are inlined (not imported from core/config) so the MAIN-world
// bundle stays free of extension-module side effects. The ISOLATED content
// script pushes remotely-updated patterns via postMessage on startup.
installFetchInterceptor(['/rest/sse/perplexity_ask']);
