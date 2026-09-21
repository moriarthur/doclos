import { ExportService } from './export.service';

// escapeCell is a pure helper; the repositories are not exercised, so empty
// stubs are enough to construct the service.
const service = new ExportService({} as any, {} as any, {} as any);
const escapeCell = (v: unknown) => (service as unknown as { escapeCell: (x: unknown) => unknown }).escapeCell(v);

describe('ExportService.escapeCell (formula-injection guard)', () => {
  it.each([
    ['=CMD("calc")', 'CMD("calc")'],
    ['+1+1', '1+1'],
    ['-2', '2'],
    ['@SUM(A1)', 'SUM(A1)'],
    ['  =evil', 'evil'],
    ['clean value', 'clean value'],
    ['Rechnung-123', 'Rechnung-123'],
  ])('strips a leading formula trigger from %p', (input, expected) => {
    expect(escapeCell(input)).toBe(expected);
  });

  it.each([[42, 42], [0, 0], [null, null], [undefined, undefined]])(
    'leaves non-string %p untouched',
    (input, expected) => {
      expect(escapeCell(input)).toBe(expected);
    },
  );
});
