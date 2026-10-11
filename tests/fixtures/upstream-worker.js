import { errorResponse } from '../../worker/src/http.js';
import { lookupBarcode } from '../../worker/src/providers.js';

export default {
  async fetch(request) {
    try {
      const result = await lookupBarcode(await request.json(), {
        BARCODE_PROVIDER: 'json',
        BARCODE_PROVIDER_URL: 'https://provider.test/lookup',
        BARCODE_PROVIDER_KEY: 'test-only-provider',
      });
      return Response.json(result);
    } catch (error) {
      return errorResponse(error);
    }
  },
};
