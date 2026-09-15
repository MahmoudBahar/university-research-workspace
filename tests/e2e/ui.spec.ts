import { test, expect } from '@playwright/test';

/**
 * Interface behaviour that the redesign added: a remembered theme, a
 * collapsible department tree, the global university switcher and the
 * command palette. These run against the same seeded fictional workspace as
 * the flows, after them, in fresh browser contexts.
 */
test.describe.configure({ mode: 'serial' });

const UNIVERSITY_NAME = 'Northvale Institute of Technology';

test('the theme choice persists across a reload and system clears it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Theme: dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('urw.theme'))).toBe('dark');

  await page.getByRole('button', { name: 'Theme: system' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
});

test('collapsing a faculty hides its departments and expanding restores them', async ({ page }) => {
  await page.goto('/scope');
  const row = page.locator('.tree .node', { hasText: 'Department of Mechanical Engineering' });
  await expect(row).toHaveCount(1);
  await expect(row).toBeVisible();

  await page.getByRole('button', { name: 'Collapse Faculty of Engineering' }).click();
  await expect(row).toBeHidden();
  await expect(row).toHaveCount(1);

  await page.getByRole('button', { name: 'Expand Faculty of Engineering' }).click();
  await expect(row).toBeVisible();

  await page.getByRole('button', { name: 'Collapse all' }).click();
  await expect(row).toBeHidden();
  await page.getByRole('button', { name: 'Expand all' }).click();
  await expect(row).toBeVisible();
});

test('the university switcher filters people and follows you across pages', async ({ page }) => {
  await page.goto('/people');
  const filtered = page.waitForRequest((request) => request.url().includes('/api/people') && request.url().includes('university='));
  await page.locator('#university-switcher').selectOption({ label: UNIVERSITY_NAME });
  await filtered;
  await expect(page).toHaveURL(/university=/);
  await expect(page.getByRole('link', { name: 'Dr Amara Osei' })).toBeVisible();

  await page.getByRole('link', { name: 'Programs' }).click();
  await expect(page).toHaveURL(/\/programs\?.*university=/);
  await expect(page.getByRole('button', { name: /Master of Applied Science/ })).toBeVisible();

  await page.locator('#university-switcher').selectOption('all');
  await expect(page).not.toHaveURL(/university=/);
  expect(await page.evaluate(() => localStorage.getItem('urw.university'))).toBe('all');
});

test('the command palette finds a person and opens the profile', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+k');
  const input = page.getByRole('combobox', { name: /Search people/ });
  await expect(input).toBeFocused();
  await input.fill('Osei');
  // People rank first; drafts, tasks and notes about the same person follow.
  const option = page.getByRole('option', { name: /Dr Amara Osei/ }).first();
  await expect(option).toBeVisible();
  await option.click();
  await expect(page).toHaveURL(/\/people\/person-/);
  await expect(page.getByRole('heading', { name: 'Dr Amara Osei' })).toBeVisible();
});

test('the Email ready column sorts on how many blockers a person has', async ({ page }) => {
  await page.goto('/people');
  // A person who is ready sorts ahead of everyone; the rest rank by blocker
  // count, so the pill a row shows is the value the column sorts on.
  const ranks = async () =>
    (await page.locator('table tbody tr').allInnerTexts()).map((text) => {
      const blockers = /(\d+) blocker\(s\)/.exec(text);
      return blockers ? Number(blockers[1]) : -1;
    });

  const header = page.getByRole('button', { name: /^Email ready/ });
  await header.click();
  const ascending = await ranks();
  // The fixture seeds a ready person, one-blocker people and two-blocker
  // people; without more than one rank the assertions below prove nothing.
  expect(new Set(ascending).size).toBeGreaterThan(1);
  expect(ascending).toEqual([...ascending].sort((a, b) => a - b));

  await header.click();
  expect(await ranks()).toEqual([...ascending].sort((a, b) => b - a));
});
