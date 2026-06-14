import { defineCloudflareConfig } from '@opennextjs/cloudflare'

// Default Cloudflare config. Incremental cache (R2/KV), queues, and tag cache
// can be layered in here later as the deployment matures.
export default defineCloudflareConfig({})
