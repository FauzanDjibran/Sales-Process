import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { appsOf, landingHref, visibleModules } from "../src/lib/erp/nav";

/**
 * Two applications behind one sign-in (P254): which a user has, and where they
 * land. Pure functions over permission codes, so no database.
 */
const ERP_ONLY = ["MENU_DASHBOARD_ACCESS"];
const PRODUCTION_ONLY = ["MENU_PRODUCTION_ACCESS", "PRODUCTION_UNIT_VIEW"];
const BOTH = [...ERP_ONLY, ...PRODUCTION_ONLY];

describe("the application a user has decides where they land", () => {
  test("a user with both lands on the picker", () => {
    assert.deepEqual(appsOf(BOTH), ["erp", "production"]);
    assert.equal(landingHref(BOTH), "/apps");
  });

  test("a user with one goes straight in", () => {
    assert.deepEqual(appsOf(ERP_ONLY), ["erp"]);
    assert.equal(landingHref(ERP_ONLY), "/dashboard");
    assert.deepEqual(appsOf(PRODUCTION_ONLY), ["production"]);
    assert.equal(landingHref(PRODUCTION_ONLY), "/production/workspace");
  });

  test("the picker sends each application to its own first menu", () => {
    assert.equal(landingHref(BOTH, "erp"), "/dashboard");
    assert.equal(landingHref(BOTH, "production"), "/production/workspace");
  });

  test("Profil Saya alone gives no application", () => {
    assert.deepEqual(appsOf([]), []);
    assert.equal(landingHref([]), "/settings/profile");
  });

  test("each shell lists only its own application's modules", () => {
    assert.deepEqual(visibleModules(BOTH, "production").map((m) => m.key), ["production"]);
    assert.ok(!visibleModules(BOTH, "erp").some((m) => m.key === "production"));
  });
});
