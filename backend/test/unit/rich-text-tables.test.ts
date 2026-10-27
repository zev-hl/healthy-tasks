import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { richTextLength, sanitizeRichText } from '../../src/utils/rich-text.js';

/** Tables in rich text (HLAI-112): kept, with nothing on them but cell spans. */

describe('tables in rich text', () => {
  const TABLE =
    '<table><tbody>' +
    '<tr><th><p>No.</p></th><th><p>ASIN</p></th></tr>' +
    '<tr><td><p>1</p></td><td><p>B0ABC12345</p></td></tr>' +
    '</tbody></table>';

  it('keeps a table as the editor writes it, in descriptions and comments', () => {
    assert.equal(sanitizeRichText(TABLE), TABLE);
    assert.equal(sanitizeRichText(TABLE, { allowMentions: true }), TABLE);
  });

  it('drops widths, styles and other attributes, and the column sizes', () => {
    const dirty =
      '<table style="min-width: 75px" class="x"><colgroup><col style="min-width: 25px"></colgroup><tbody>' +
      '<tr><th colspan="1" rowspan="1" style="width:9px" colwidth="40"><p>No.</p></th>' +
      '<th colspan="1" rowspan="1" onclick="x()"><p>ASIN</p></th></tr>' +
      '<tr><td colspan="1" rowspan="1"><p>1</p></td><td colspan="1" rowspan="1"><p>B0ABC12345</p></td></tr>' +
      '</tbody></table>';
    assert.equal(
      sanitizeRichText(dirty),
      '<table><tbody>' +
        '<tr><th colspan="1" rowspan="1"><p>No.</p></th><th colspan="1" rowspan="1"><p>ASIN</p></th></tr>' +
        '<tr><td colspan="1" rowspan="1"><p>1</p></td><td colspan="1" rowspan="1"><p>B0ABC12345</p></td></tr>' +
        '</tbody></table>',
    );
  });

  it('keeps a span only as a small whole number', () => {
    assert.equal(
      sanitizeRichText(
        '<table><tbody><tr><td colspan="2" rowspan="0">a</td><td colspan="1000" rowspan="x">b</td></tr></tbody></table>',
      ),
      '<table><tbody><tr><td colspan="2">a</td><td>b</td></tr></tbody></table>',
    );
  });

  it('still strips scripts and other links inside cells', () => {
    assert.equal(
      sanitizeRichText(
        '<table><tbody><tr><td><script>alert(1)</script><a href="https://x.test">see</a></td></tr></tbody></table>',
      ),
      '<table><tbody><tr><td><span>see</span></td></tr></tbody></table>',
    );
  });

  it('counts the words in a table towards the limit, not its markup', () => {
    assert.equal(richTextLength(TABLE), 'No.ASIN1B0ABC12345'.length);
  });
});
