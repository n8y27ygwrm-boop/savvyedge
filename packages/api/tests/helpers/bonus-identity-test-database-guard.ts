/**
 * Bonus-identity view of the shared destructive-database boundary.
 *
 * The strict effective-target validation now lives in
 * `./isolated-test-database-guard`, because the same boundary protects every
 * destructive real-database suite. This module stays as the stable entry point
 * for the bonus-identity suite.
 */
import {
  isApprovedIsolatedTestDatabase,
  type IsolatedTestDatabaseUrls,
} from "./isolated-test-database-guard";

export type BonusIdentityTestDatabaseUrls = IsolatedTestDatabaseUrls;

export function isApprovedBonusIdentityTestDatabase(
  urls: BonusIdentityTestDatabaseUrls,
): boolean {
  return isApprovedIsolatedTestDatabase(urls);
}
