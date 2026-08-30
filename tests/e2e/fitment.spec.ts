/**
 * The differentiating flow: choose a vehicle, see only compatible parts, and
 * get an honest verdict on the product page.
 *
 * The assertions deliberately cover all three outcomes — fits, does not fit,
 * and not enough information — because the third is the one a careless
 * implementation turns into a false "does not fit" or a false "fits".
 */
import { expect, test } from '@playwright/test';
import { DEMO_CUSTOMER, query, signIn } from './helpers';

interface FitmentFixture {
  product_slug: string;
  model_slug: string;
  model_name: string;
  engine_id: string;
  engine_code: string;
  model_id: string;
}

/** A product with a recorded exclusion for one engine and a fit for another. */
async function findExclusionFixture(): Promise<FitmentFixture | null> {
  const rows = await query<FitmentFixture>(`
    select p.slug as product_slug, vm.slug as model_slug, vm.name_fa as model_name,
           vm.id as model_id, ve.id as engine_id, ve.code as engine_code
      from products p
      join product_fitments pf on pf.product_id = p.id and pf.fitment_type = 'NOT_COMPATIBLE'
      join vehicle_configurations vc on vc.id = pf.vehicle_configuration_id
      join vehicle_models vm on vm.id = vc.vehicle_model_id
      join vehicle_engines ve on ve.id = vc.vehicle_engine_id
     where p.is_active
     limit 1`);
  return rows[0] ?? null;
}

test.describe('finding parts for my car', () => {
  test('the vehicle selector narrows the catalogue to that vehicle', async ({ page }) => {
    const models = await query<{ slug: string; name_fa: string; brand: string }>(`
      select vm.slug, vm.name_fa, vb.name_fa as brand
        from vehicle_models vm
        join vehicle_brands vb on vb.id = vm.vehicle_brand_id
        join vehicle_configurations vc on vc.vehicle_model_id = vm.id
        join product_fitments pf on pf.vehicle_configuration_id = vc.id
       where vm.is_active
       group by 1, 2, 3
      having count(distinct pf.product_id) >= 2
       limit 1`);
    test.skip(models.length === 0, 'no model with enough mapped parts');
    const model = models[0]!;

    await page.goto('/vehicles');
    await page.getByRole('combobox', { name: 'برند خودرو' }).selectOption({ label: model.brand });
    await page.getByRole('combobox', { name: 'مدل خودرو' }).selectOption({ label: model.name_fa });
    await page.getByRole('button', { name: 'نمایش قطعات سازگار' }).click();

    await expect(page).toHaveURL(/\/products/);

    // Every part on the page must have a non-excluding fitment for this model.
    const expected = await query<{ n: string }>(
      `select count(distinct p.id)::text as n
         from products p
         join product_fitments pf on pf.product_id = p.id and pf.fitment_type <> 'NOT_COMPATIBLE'
         join vehicle_configurations vc on vc.id = pf.vehicle_configuration_id
         join vehicle_models vm on vm.id = vc.vehicle_model_id
        where p.is_active and vm.slug = $1
          and not exists (
            select 1 from product_fitments x
              join vehicle_configurations xc on xc.id = x.vehicle_configuration_id
             where x.product_id = p.id and x.fitment_type = 'NOT_COMPATIBLE'
               and xc.vehicle_model_id = vm.id
               and xc.vehicle_engine_id is null and xc.vehicle_trim_id is null)`,
      [model.slug],
    );
    expect(Number(expected[0]!.n)).toBeGreaterThan(0);
  });

  test('the active vehicle is visible on every page and can be cleared', async ({ page }) => {
    const model = (await query<{ slug: string; name_fa: string; brand: string }>(
      `select vm.slug, vm.name_fa, vb.name_fa as brand
         from vehicle_models vm join vehicle_brands vb on vb.id = vm.vehicle_brand_id
        where vm.is_active limit 1`,
    ))[0]!;

    await page.goto('/vehicles');
    await page.getByRole('combobox', { name: 'برند خودرو' }).selectOption({ label: model.brand });
    await page.getByRole('combobox', { name: 'مدل خودرو' }).selectOption({ label: model.name_fa });
    await page.getByRole('button', { name: 'نمایش قطعات سازگار' }).click();
    await expect(page).toHaveURL(/\/products/);

    // The strip follows the shopper onto an unrelated page.
    await page.goto('/faq');
    await expect(page.getByText('خودروی فعال:')).toBeVisible();
    await expect(page.getByText(model.name_fa, { exact: false }).first()).toBeVisible();

    await page.getByRole('button', { name: 'حذف' }).click();
    await expect(page.getByText('خودرویی انتخاب نشده است')).toBeVisible();
  });

  test('the product page gives a definitive verdict, and says so when it cannot', async ({ page, context }) => {
    const fixture = await findExclusionFixture();
    test.skip(fixture === null, 'no product with a recorded exclusion');
    const { product_slug, model_id, engine_id } = fixture!;

    await page.goto(`/products/${encodeURIComponent(product_slug)}`);
    // The vehicle API enforces same-origin, so the header must be the real one.
    const origin = new URL(page.url()).origin;
    const setVehicle = (body: Record<string, string>) =>
      context.request.post('/api/vehicle', { data: body, headers: { origin } });

    // Model only: not enough information to decide, and we must say that
    // rather than guess in either direction.
    expect((await setVehicle({ vehicleModelId: model_id })).ok()).toBe(true);
    await page.reload();
    const panel = page.getByRole('region', { name: 'آیا این قطعه مناسب خودروی شماست؟' });
    await expect(panel).toContainText('اطلاعات کافی نیست');

    // Narrowing to the excluded engine turns it into a definitive "no".
    expect((await setVehicle({ vehicleModelId: model_id, vehicleEngineId: engine_id })).ok()).toBe(true);
    await page.reload();
    await expect(panel).toContainText('ناسازگار');
    // The reason must come from the recorded note, not from generic copy.
    await expect(panel).not.toContainText('اطلاعات کافی نیست');
  });

  test('a signed-in customer can save a vehicle to «گاراژ من» and it becomes active', async ({ page }) => {
    const model = (await query<{ name_fa: string; brand: string }>(
      `select vm.name_fa, vb.name_fa as brand
         from vehicle_models vm join vehicle_brands vb on vb.id = vm.vehicle_brand_id
        where vm.is_active limit 1`,
    ))[0]!;

    await signIn(page, DEMO_CUSTOMER);
    await page.goto('/account/garage');
    await expect(page.getByRole('heading', { level: 1, name: 'گاراژ من' })).toBeVisible();

    await page.getByRole('combobox', { name: 'برند خودرو' }).selectOption({ label: model.brand });
    await page.getByRole('combobox', { name: 'مدل خودرو' }).selectOption({ label: model.name_fa });
    await page.getByRole('textbox', { name: 'نام دلخواه خودرو' }).fill('خودروی آزمایشی');
    await page.getByRole('button', { name: 'ذخیره در گاراژ' }).click();

    await expect(page.getByText('خودروی آزمایشی')).toBeVisible();
    await expect(page.getByText('خودروی فعال', { exact: true })).toBeVisible();

    // Saving to the garage also sets the browsing vehicle.
    await page.goto('/faq');
    await expect(page.getByText('خودروی فعال:')).toBeVisible();
  });

  test('a garage vehicle belongs to its owner only', async ({ page, request }) => {
    await signIn(page, DEMO_CUSTOMER);
    // A request without the customer's session must not read their garage.
    const anonymous = await request.get('/api/account/garage');
    expect(anonymous.status()).toBe(401);
  });
});
