-- 0005_user_billing_metrics.sql
-- Cloudflare Billing Units Per-User Tracking Table

CREATE TABLE IF NOT EXISTS user_billing_metrics (
    id                      TEXT PRIMARY KEY,         -- UUID or composite key `${userId}_${purpose}_${periodDate}`
    user_id                 TEXT NOT NULL,            -- User ID or 'anonymous'
    purpose                 TEXT NOT NULL,            -- e.g., 'STREAM_MEDIA', 'UPLOAD_FILE', 'WAL_EMIT', 'GALLERY_INDEX', 'AUTH'
    period_date             TEXT NOT NULL,            -- ISO Date String 'YYYY-MM-DD'
    
    -- Durable Object Billing Units
    do_requests             INTEGER DEFAULT 0,        -- Total DO Subrequests / Invocations
    do_duration_ms          INTEGER DEFAULT 0,        -- DO Active Wall-Clock Duration in ms
    do_gb_seconds           REAL DEFAULT 0.0,         -- DO GB-Seconds: (do_duration_ms / 1000) * 0.125
    do_storage_read_units   INTEGER DEFAULT 0,        -- DO SQLite / KV 4KB Read Units
    do_storage_write_units  INTEGER DEFAULT 0,        -- DO SQLite / KV 4KB Write Units
    do_storage_delete_units INTEGER DEFAULT 0,        -- DO SQLite / KV Delete Units
    
    -- D1 Database Billing Units
    d1_read_rows            INTEGER DEFAULT 0,        -- Exact Rows Read reported by Cloudflare D1 meta
    d1_write_rows           INTEGER DEFAULT 0,        -- Exact Rows Written reported by Cloudflare D1 meta
    d1_query_count          INTEGER DEFAULT 0,        -- Total SQL queries executed
    
    -- R2 Storage Billing Units
    r2_class_a_ops          INTEGER DEFAULT 0,        -- Class A Ops (Uploads, Writes, Deletes)
    r2_class_b_ops          INTEGER DEFAULT 0,        -- Class B Ops (Downloads, Reads)
    r2_bytes_transferred    INTEGER DEFAULT 0,        -- Egress / Ingress bytes
    
    updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, purpose, period_date)
);

CREATE INDEX IF NOT EXISTS idx_billing_user_period ON user_billing_metrics(user_id, period_date);
CREATE INDEX IF NOT EXISTS idx_billing_period ON user_billing_metrics(period_date);
