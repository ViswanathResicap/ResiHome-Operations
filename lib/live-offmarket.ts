import { connect } from "./snowflake";
import { source, sourceRaw } from "./datasets";
import type { OffMarketCache, OffMarketRow, OffMarketHero } from "./types";

const str = (v: unknown): string => (v == null ? "" : String(v));
const numOr = (v: unknown): number | null => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
const toDate = (v: unknown): Date | null => {
  if (v == null) return null;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d;
};
const MS_DAY = 86400000;
const dayDiff = (a: Date | null, b: Date | null): number | null =>
  a == null || b == null ? null : Math.round((a.getTime() - b.getTime()) / MS_DAY);
const today = new Date();

/**
 * Replicates the 'DW_Off Market'[2_STATUS_Off Market] calculated column (the
 * brain of the Off-Market hero tiles) plus its prerequisite columns.
 *
 * DEFERRED BY REQUEST: '2_PC Status' depends on QC_ResiAims, a manually
 * uploaded SharePoint CSV ("Property Pre Checklist Report.csv") owned by
 * Hayden — not a Snowflake source. Per direction, this is intentionally
 * ignored for now (PC_STATUS_PENDING below) and will be wired in once that
 * file is connected. Until then, every property's pcStatus reads as null,
 * which the DAX itself maps to "Not PC Passed" — so today properties that
 * should split across "Not PC Passed" / the "Ready to List" branches /
 * "Pending RRQC" will skew toward "Not PC Passed" and "Pending RRQC" only.
 *
 * KNOWN APPROXIMATION: '1_Turn_Ready_to_List' depends on a separate DW_Turns
 * table (most-recent turn's status per property) that isn't wired up yet —
 * treated as always blank here. This affects a couple of fallback branches;
 * the primary QC-based paths are unaffected.
 */
const PC_STATUS_PENDING = true; // flip once QC_ResiAims is connected — see note above.

function computeStatus(r: Record<string, unknown>) {
  const occStatus = str(r.OCCUPANCY_STATUS);
  const orgKey = numOr(r.ORGANIZATION_KEY);
  const orgName = str(r.ORGANIZATION_NAME);
  const reasonOffMarket = str(r.REASONOFFMARKETNAME) || null;
  const purchaseType = str(r["Purchase Type"]);
  const moveInReady = toDate(r.MOVEINREADY);
  const conDateFwOrComplete = toDate(r.CON_DATE_FW_OR_COMPLETE);
  const projectedCompletionDate = toDate(r.PROJECTEDCOMPLETIONDATE);
  const listingStatus = str(r.Listing_Status_Name);
  const qcTriggerDate = toDate(r.QC_TRIGGER_DATE);
  const drcCoDate = toDate(r.DRC_CO_DATE);
  const qcResult = str(r["2_AM_QC_Result"]) || null; // "Pass" | null
  const qcResultDate = toDate(r["2_AM_QC_Result_Date"]);
  const woOpenCount = numOr(r["2_MM_WO_Open_Count"]);
  const tktCreatedDate = toDate(r["2_MM_TKT_Created_Date"]);
  const woClosedDate = toDate(r["2_MM_WO_Closed_Date"]);
  const pictureCount = numOr(r.PICTURE_COUNT);
  const cabinetsPreleaseDate = toDate(r.CABINETS_PRELEASE_DATE);
  const finalWalkDate = toDate(r.FINAL_WALK_DATE);
  // 2_PC Status: requires QC_ResiAims (Hayden's SharePoint file) — deferred per direction until connected.
  const pcStatus: string | null = PC_STATUS_PENDING ? null : null;
  // 1_Turn_Ready_to_List: requires DW_Turns — not wired yet.
  const turnReadyToList: string | null = null;

  // 1_CON_QC_Needed
  const conQcNeeded = finalWalkDate != null && qcResultDate == null && str(r.AM_PROPERTY_STATUS) !== "Under Construction";

  // 2_Off Market Page Flag
  const offMarketFlag =
    occStatus === "Vacant - Off Market" ||
    (occStatus === "Under Construction" &&
      projectedCompletionDate != null &&
      dayDiff(new Date(projectedCompletionDate.getTime() + 7 * MS_DAY), new Date(today.getTime() + 25 * MS_DAY)) != null &&
      new Date(projectedCompletionDate.getTime() + 7 * MS_DAY) <= new Date(today.getTime() + 25 * MS_DAY) &&
      pcStatus === "Cleared to Move-In" &&
      woOpenCount == null &&
      listingStatus !== "Active" &&
      listingStatus !== "Deposit Taken") ||
    turnReadyToList === "Ready to List" ||
    (orgKey === 27 && qcResult !== "Pass");

  if (!offMarketFlag && !conQcNeeded) return { status: null, daysInStatus: null, pcStatus, daysOffMarketActive: null };

  let status: string;
  if (conQcNeeded) status = "Final Walk - Schedule QC";
  else if (reasonOffMarket && reasonOffMarket !== "Maintenance In Progress") status = "Squatter / Other";
  else if (
    occStatus === "Under Construction" &&
    projectedCompletionDate != null &&
    new Date(projectedCompletionDate.getTime() + 7 * MS_DAY) <= new Date(today.getTime() + 25 * MS_DAY) &&
    pcStatus === "Cleared to Move-In" &&
    woOpenCount == null &&
    listingStatus !== "Active" &&
    listingStatus !== "Deposit Taken"
  )
    status = "Ready to List - Prelease";
  else if (purchaseType !== "New Construction" && orgKey === -1 && !reasonOffMarket && moveInReady == null && conDateFwOrComplete == null)
    status = "Send / Under Construction";
  else if (orgKey === 27 && (qcTriggerDate == null || drcCoDate == null)) status = "Send / Under Construction";
  else if (
    qcResult === "Pass" &&
    pcStatus === "Cleared to Move-In" &&
    (woOpenCount == null || (qcResultDate != null && tktCreatedDate != null && qcResultDate > tktCreatedDate && qcResult === "Pass")) &&
    (occStatus === "Vacant - Off Market" || occStatus === "Under Construction") &&
    !reasonOffMarket
  )
    status = (pictureCount ?? 0) > 5 ? "Ready to List - On Market" : "Ready to List - Awaiting Photos";
  else if (turnReadyToList === "Ready to List" && pcStatus === "Cleared to Move-In" && !reasonOffMarket)
    status = (pictureCount ?? 0) > 5 ? "Ready to List - On Market" : "Ready to List - Awaiting Photos";
  else if (
    (qcResult === "Pass" || turnReadyToList === "Ready to List") &&
    pcStatus === "Cleared to Move-In" &&
    purchaseType === "New Construction" &&
    orgKey === -1 &&
    (occStatus === "Vacant - Off Market" || occStatus === "Under Construction") &&
    !reasonOffMarket &&
    (woOpenCount == null || (tktCreatedDate != null && toDate(r.OFFMARKETDATE) != null && tktCreatedDate <= (toDate(r.OFFMARKETDATE) as Date)))
  )
    status = (pictureCount ?? 0) > 5 ? "Ready to List - On Market" : "Ready to List - Awaiting Photos";
  else if (woOpenCount == null && qcResult === "Fail" && tktCreatedDate != null && qcResultDate != null && tktCreatedDate <= qcResultDate)
    status = "RRQC Fail";
  else if (
    qcResult !== "Pass" &&
    (woOpenCount == null || orgName === "RB DRC") &&
    reasonOffMarket !== "Maintenance In Progress" &&
    !turnReadyToList &&
    (qcResult !== "Pass" || (tktCreatedDate != null && qcResultDate != null && tktCreatedDate >= qcResultDate && woClosedDate != null && woClosedDate >= qcResultDate))
  )
    status = "Pending RRQC";
  else if (woOpenCount != null || reasonOffMarket === "Maintenance In Progress") status = "Pending Maintenance";
  else if (pcStatus === "Not Cleared to Move-In" || pcStatus == null) status = "Not PC Passed";
  else if (orgKey === 27 && cabinetsPreleaseDate != null && today >= cabinetsPreleaseDate && !str(r.LISTINGDATE)) status = "Ready to List - Prelease";
  else status = "NO BUCKET";

  // 2_Days_Off_Market_Active
  const offMarketDate = toDate(r.OFFMARKETDATE);
  const transferDate = toDate(r.Transfer_Date);
  const daysOffMarketActive =
    occStatus !== "Vacant - Off Market" ? null : Math.ceil((dayDiff(today, offMarketDate ?? moveInReady ?? transferDate) ?? 0));

  // 2_Days in Status
  let daysInStatus: number | null = null;
  if (offMarketFlag && daysOffMarketActive != null) {
    let switchVal: number | null = null;
    switch (status) {
      case "Not PC Passed": {
        const a = qcResultDate ?? moveInReady, b = toDate(r.Purchase_Date);
        const base = a && b ? (a > b ? a : b) : a ?? b;
        switchVal = dayDiff(today, base);
        break;
      }
      case "Missing Rently":
        switchVal = dayDiff(today, qcResultDate ?? offMarketDate);
        break;
      case "Pending Maintenance":
        switchVal = dayDiff(today, tktCreatedDate);
        break;
      case "Pending RRQC":
        switchVal = dayDiff(today, woClosedDate ?? qcResultDate ?? transferDate);
        break;
      case "Ready to List - On Market":
      case "Ready to List - Awaiting Photos":
      case "Ready to List - Preleasing":
      case "RRQC Fail":
        switchVal = dayDiff(today, qcResultDate);
        break;
      case "Squatter / Other":
        switchVal = dayDiff(today, offMarketDate ?? transferDate);
        break;
      default:
        switchVal = null;
    }
    daysInStatus = switchVal == null ? 0 : Math.max(0, Math.min(switchVal, daysOffMarketActive));
  }

  return { status, daysInStatus, pcStatus, daysOffMarketActive };
}

export async function getLiveOffMarket(): Promise<OffMarketCache> {
  const conn = await connect();
  const errors: string[] = [];
  let rawRows: Record<string, unknown>[] = [];
  try {
    try {
      rawRows = await conn.query(source("offMarket"));
    } catch (e) {
      errors.push(`offMarket projection: ${(e as Error).message}`);
      rawRows = await conn.query(sourceRaw("offMarket"));
    }
  } catch (e) {
    errors.push(`offMarket: ${(e as Error).message}`);
  } finally {
    conn.close();
  }

  const rows: OffMarketRow[] = [];
  const seen = new Set<unknown>();
  const hero: OffMarketHero = {
    finalWalkConQC: 0, sendUnderCon: 0, notPcPassed: 0, squatter: 0, other: 0,
    pendingMaint: 0, pendingRRQC: 0, rrqcFail: 0, missingRently: 0,
    rtlNeedsPhotos: 0, readyToListPL: 0, readyToList: 0, avgDaysInStatus: {},
  };
  const daysByBucket: Record<string, number[]> = {};
  let offMarketCount = 0;
  const daysOffMarketAll: number[] = [];

  for (const r of rawRows) {
    const key = r.PROPERTY_KEY;
    if (key != null && seen.has(key)) continue;
    if (key != null) seen.add(key);

    if (str(r.OCCUPANCY_STATUS) === "Vacant - Off Market") offMarketCount++;

    const { status, daysInStatus, pcStatus, daysOffMarketActive } = computeStatus(r);
    if (daysOffMarketActive != null) daysOffMarketAll.push(daysOffMarketActive);
    if (status) {
      (daysByBucket[status] ??= []).push(daysInStatus ?? 0);
      const reasonOffMarket = str(r.REASONOFFMARKETNAME);
      switch (status) {
        case "Final Walk - Schedule QC": hero.finalWalkConQC++; break;
        case "Send / Under Construction": hero.sendUnderCon++; break;
        case "Not PC Passed": hero.notPcPassed++; break;
        case "Squatter / Other":
          if (reasonOffMarket === "Squatter") hero.squatter++; else hero.other++;
          break;
        case "Pending Maintenance": hero.pendingMaint++; break;
        case "Pending RRQC": hero.pendingRRQC++; break;
        case "RRQC Fail": hero.rrqcFail++; break;
        case "Missing Rently": hero.missingRently++; break;
        case "Ready to List - Awaiting Photos": hero.rtlNeedsPhotos++; break;
        case "Ready to List - Prelease": hero.readyToListPL++; break;
        case "Ready to List - On Market": hero.readyToList++; break;
      }
    }

    rows.push({
      key: str(r.PROPERTY_KEY),
      entityId: str(r.ENTITYID),
      org: str(r.ORGANIZATION_NAME),
      region: str(r.REGION_NAME),
      subdivision: str(r.SUBDIVISION),
      floorplan: str(r.FLOORPLAN),
      address: str(r.Full_Address || r.ADDRESS),
      occupancyStatus: str(r.OCCUPANCY_STATUS),
      propertyStatus: str(r.AM_PROPERTY_STATUS),
      purchaseType: str(r["Purchase Type"]),
      pcStatus,
      transferDate: r.Transfer_Date ? str(r.Transfer_Date) : null,
      purchaseDate: r.Purchase_Date ? str(r.Purchase_Date) : null,
      daysOffMarket: daysOffMarketActive,
      diq: numOr(r["2_AM_QC_Result_Date"] ? dayDiff(today, toDate(r["2_AM_QC_Result_Date"])) : null),
      conCompleteOrFinalWalk: r.CON_DATE_FW_OR_COMPLETE ? str(r.CON_DATE_FW_OR_COMPLETE) : null,
      offMarketDate: r.OFFMARKETDATE ? str(r.OFFMARKETDATE) : null,
      reasonOffMarket: str(r.REASONOFFMARKETNAME) || null,
      wosOpen: numOr(r["2_MM_WO_Open_Count"]),
      wosClosed: numOr(r["2_MM_WO_Closed Count"]),
      lastTktCreated: r["2_MM_TKT_Created_Date"] ? str(r["2_MM_TKT_Created_Date"]) : null,
      lastWoClosed: r["2_MM_WO_Closed_Date"] ? str(r["2_MM_WO_Closed_Date"]) : null,
      status,
      daysInStatus,
    });
  }

  for (const [bucket, vals] of Object.entries(daysByBucket)) {
    hero.avgDaysInStatus[bucket] = vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10 : null;
  }

  const avgDaysOffMarket = daysOffMarketAll.length
    ? Math.round((daysOffMarketAll.reduce((s, v) => s + v, 0) / daysOffMarketAll.length) * 10) / 10
    : null;

  return {
    _meta: {
      source: "SNOWFLAKE",
      generatedAt: new Date().toISOString(),
      note: "Live. QC_ResiAims (Hayden's SharePoint pre-checklist) isn't connected yet, so 'PC Status' / 'Not PC Passed' aren't accurate — pending that file. 1_Turn_Ready_to_List (DW_Turns) is also a placeholder for a couple of fallback branches.",
      errors: errors.length ? errors : undefined,
    },
    hero,
    offMarketSelected: offMarketCount,
    avgDaysOffMarket,
    rows: rows.filter((r) => r.occupancyStatus === "Vacant - Off Market"),
  };
}
