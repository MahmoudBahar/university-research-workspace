import { test, expect } from '@playwright/test';

/**
 * The four flows the specification calls for: a department selection, a
 * partially finished research queue, an edited approved email, and a manual
 * sent record — all through the interface, against the real API and core.
 *
 * The steps build on one another against a single seeded workspace, so they run
 * in order.
 */
test.describe.configure({ mode: 'serial' });

test('the overview reports the execution model honestly', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByText('No Claude assignment is executing.')).toBeVisible();
  await expect(page.getByText(/Queued work waits until you start or resume a Claude Code session/)).toBeVisible();
});

test('a department selection can be changed and confirmed', async ({ page }) => {
  await page.goto('/scope');
  await expect(page.getByRole('heading', { name: 'Departments' })).toBeVisible();

  // Mechanical Engineering starts undecided; include it. `.node` rows do not
  // nest, so this cannot accidentally match the parent faculty.
  const row = page.locator('.tree .node', { hasText: 'Department of Mechanical Engineering' });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: 'Include' }).click();
  await page.getByRole('button', { name: /Save 1 change/ }).click();
  await expect(page.getByRole('status').filter({ hasText: /Saved draft version 2/ })).toBeVisible();

  await page.getByRole('button', { name: /Confirm selection/ }).click();
  const confirmation = page.getByRole('status').filter({ hasText: /Confirmed version 2\./ });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText(/across 2 included unit\(s\)/);

  // Previous research survives the scope change: the ECE program note is intact.
  await page.goto('/programs');
  await expect(page.getByRole('button', { name: /Master of Applied Science/ })).toBeVisible();
});

test('the queue shows a partially finished pipeline and the exact command to run', async ({ page }) => {
  await page.goto('/queue');
  await expect(page.getByRole('heading', { name: 'Queue' })).toBeVisible();
  await expect(page.getByText('Queued — start or resume Claude Code.')).toBeVisible();
  await expect(page.locator('code').filter({ hasText: '/research-university --resume' })).toBeVisible();

  // Job 5 is complete for one person while others are still at Job 4.
  await expect(page.getByRole('row').filter({ hasText: 'map person sources' }).first()).toBeVisible();
});

test('a person page separates rank from role and labels evidence honestly', async ({ page }) => {
  await page.goto('/people');
  await page.getByRole('link', { name: 'Dr Amara Osei' }).click();
  await expect(page.getByRole('heading', { name: 'Dr Amara Osei' })).toBeVisible();
  await expect(page.getByText('role category associate professor')).toBeVisible();
  await expect(
    page.getByText('Inferred from the campus location. It does not say where the person is now.'),
  ).toBeVisible();

  await page.getByRole('tab', { name: 'publications' }).click();
  await expect(page.getByText('abstract only').first()).toBeVisible();
  await expect(page.getByText('metadata only').first()).toBeVisible();

  await page.getByRole('tab', { name: 'sources' }).click();
  await expect(page.getByRole('cell').filter({ hasText: /^blocked$/ }).first()).toBeVisible();
});

test('an approved email returns to review when its body changes', async ({ page }) => {
  await page.goto('/review');
  await page.getByRole('button', { name: 'Review', exact: true }).first().click();
  await expect(page.getByText('FINGERPRINT')).toBeVisible();
  await page.getByRole('button', { name: 'Approve this exact revision' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Approved revision 1/ })).toBeVisible();

  await page.goto('/outreach/draft-0001');
  const body = page.getByLabel('Message body');
  await body.click();
  await body.press('End');
  await body.pressSequentially(' EDITED');
  await page.getByRole('button', { name: 'Save revision' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Approval invalidated/ })).toBeVisible();
  await expect(page.getByText('needs review').first()).toBeVisible();

  // Re-approving the edited revision puts it back in a sendable state.
  await page.goto('/review');
  await page.getByRole('button', { name: 'Review', exact: true }).first().click();
  await page.getByRole('button', { name: 'Approve this exact revision' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Approved revision 2/ })).toBeVisible();
});

test('a nonexistent local time is refused and a valid one is planned', async ({ page }) => {
  await page.goto('/planner');
  await page.getByRole('button', { name: /Plan a time/ }).first().click();

  await page.getByLabel("Date in the recipient's zone").fill('2027-03-14');
  await page.getByLabel('Time', { exact: true }).fill('02:30');
  await page.getByRole('button', { name: 'Save plan' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /does not exist in America\/Toronto/ })).toBeVisible();

  await page.getByLabel("Date in the recipient's zone").fill('2026-09-09');
  await page.getByLabel('Time', { exact: true }).fill('09:00');
  await page.getByRole('button', { name: 'Save plan' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Nothing is sent by this/ })).toBeVisible();

  // The time has passed, so it shows as overdue — and nothing was sent.
  await expect(page.getByText('overdue')).toBeVisible();
  await expect(page.getByRole('cell').filter({ hasText: /^approved$/ }).first()).toBeVisible();
});

test('marking a message sent is explicit and lands in immutable history', async ({ page }) => {
  await page.goto('/planner');
  await expect(page.getByText('overdue')).toBeVisible();

  await page.getByRole('button', { name: 'I sent this' }).first().click();
  await expect(page.getByRole('status').filter({ hasText: /Recorded your report that the message was sent/ })).toBeVisible();

  await page.goto('/sent');
  await expect(page.getByText('a.osei@northvale.invalid')).toBeVisible();
  await expect(page.getByText(/Nothing here implies delivery, reading or a reply/)).toBeVisible();

  // The snapshot is readable and belongs to the version that was approved.
  await page.getByRole('button', { name: 'Snapshot' }).first().click();
  await expect(page.getByText(/Stored exactly as it was when you reported the send/)).toBeVisible();
});
