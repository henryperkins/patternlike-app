import type { DailyReading } from "@patternlike/reading-engine";
import {
  M3_SCHEMA_VERSION,
  M5_SCHEMA_VERSION,
  type DailyReadingV5,
} from "@patternlike/shared";
import type { PublishedReading, ReadingRecord } from "../db/readings.js";
import { assertM5TodayResponse } from "./m5-product-contract.js";
import { isStoredReadingV5 } from "./stored-reading.js";

function evidenceUrl(record: ReadingRecord): string {
  return `/v1/readings/${record.id}/evidence`;
}

function projectReading(reading: DailyReading) {
  return {
    schema_version: reading.schema_version,
    output_schema: reading.output_schema,
    reading_id: reading.reading_id,
    local_date: reading.local_date,
    generated_at: reading.generated_at,
    assembly_mode: reading.assembly_mode,
    revision: reading.revision,
    locale: reading.locale,
    domain_preference: reading.domain_preference ?? null,
    paragraphs: reading.paragraphs.map((paragraph) => ({
      paragraph_id: paragraph.paragraph_id,
      role: paragraph.role,
      order: paragraph.order,
      text: paragraph.text,
    })),
    fallback_used: reading.fallback_used,
  };
}

function projectReadingV5(reading: DailyReadingV5) {
  return {
    schema_version: reading.schema_version,
    output_schema: reading.output_schema,
    reading_id: reading.reading_id,
    local_date: reading.local_date,
    generated_at: reading.generated_at,
    assembly_mode: reading.assembly_mode,
    revision: reading.revision,
    locale: reading.locale,
    domain_preference: reading.domain_preference ?? null,
    headline: reading.headline,
    disclosure: reading.disclosure,
    paragraphs: reading.paragraphs.map((paragraph) => ({
      paragraph_id: paragraph.paragraph_id,
      role: paragraph.role,
      order: paragraph.order,
      text: paragraph.text,
    })),
  };
}

export function projectReadingResponse(published: PublishedReading) {
  const evidence_url = evidenceUrl(published.record);
  if (isStoredReadingV5(published.stored)) {
    const response = {
      schema_version: M5_SCHEMA_VERSION,
      reading: projectReadingV5(published.stored.reading),
      evidence_url,
    };
    assertM5TodayResponse(response);
    return response;
  }
  return {
    schema_version: M3_SCHEMA_VERSION,
    reading: projectReading(published.stored.reading),
    evidence_url,
  };
}
