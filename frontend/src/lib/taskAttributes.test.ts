import { describe, expect, it } from 'vitest';
import {
  NOT_SET,
  attributeFilterChips,
  attributeFilterCleared,
  attributeFilterPatch,
  attributeFilterSelected,
  taskAttributeList,
  taskAttributeText,
} from './taskAttributes';

describe("a task's attributes as text", () => {
  const task = {
    alertGroup: { id: 4, name: 'Versure Exclusives' },
    alertType: 'BuyBoxLost' as const,
  };

  it('gives each value, by label, in display order', () => {
    expect(taskAttributeText('alertGroup', task)).toBe('Versure Exclusives');
    expect(taskAttributeText('alertType', task)).toBe('Buy Box Lost');
    expect(taskAttributeList(task)).toEqual([
      { key: 'alertGroup', label: 'Alert Group', value: 'Versure Exclusives' },
      { key: 'alertType', label: 'Alert Type', value: 'Buy Box Lost' },
    ]);
  });

  it('gives null for an attribute that is not set', () => {
    expect(taskAttributeList({ alertGroup: null, alertType: null }).map((a) => a.value)).toEqual([
      null,
      null,
    ]);
  });
});

describe('the attribute filter', () => {
  it('turns ticked values into the request, "(not set)" included', () => {
    expect(attributeFilterPatch('alertGroup', [NOT_SET, '4', '7'])).toEqual({
      alertGroupIds: [4, 7],
      includeNoAlertGroup: true,
    });
    expect(attributeFilterPatch('alertType', ['PriceChanged'])).toEqual({
      alertTypes: ['PriceChanged'],
      includeNoAlertType: undefined,
    });
  });

  it('reads the ticks back from the request', () => {
    const filters = {
      alertGroupIds: [4],
      includeNoAlertGroup: true,
      alertTypes: ['BuyBoxLost' as const],
    };
    expect(attributeFilterSelected('alertGroup', filters)).toEqual([NOT_SET, '4']);
    expect(attributeFilterSelected('alertType', filters)).toEqual(['BuyBoxLost']);
    expect(attributeFilterSelected('alertType', {})).toEqual([]);
  });

  it('clears one attribute without touching the other', () => {
    expect(attributeFilterCleared('alertType')).toEqual({
      alertTypes: [],
      includeNoAlertType: undefined,
    });
  });

  it('makes one chip per filtered attribute, counting "(not set)"', () => {
    expect(
      attributeFilterChips({ alertGroupIds: [4], includeNoAlertGroup: true, alertTypes: [] }),
    ).toEqual([{ key: 'alertGroup', label: 'Alert Group · 2' }]);
    expect(attributeFilterChips({})).toEqual([]);
  });
});
