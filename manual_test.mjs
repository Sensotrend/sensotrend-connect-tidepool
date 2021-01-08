import fhirClientTest from './test/fhirclient.test.mjs';
import tidepoolTest from './test/tidepoolrest.test.mjs';

describe('Manual testing', function () {
  describe('FhirClientTesting', fhirClientTest.bind(this));
  describe('TidepoolTesting', tidepoolTest.bind(this));
});
