# 🗄️ Enterprise Database & Storage Architecture Rules

## 1. Core Architecture & Standards
- **Relational Databases (RDBMS)**: PostgreSQL 16+, MySQL 8.4+, SQLite.
- **NoSQL & Document Stores**: MongoDB 7+, DynamoDB.
- **In-Memory & Caching**: Redis 7+ (Streams, Cluster, Cache-Aside pattern).
- **Vector & AI Databases**: `pgvector`, Qdrant, Pinecone, Chroma for RAG and semantic embeddings.

## 2. Senior Database Performance & Safety Guidelines
- **Zero Table Locks in Migrations**:
  - Always create indexes concurrently (`CREATE INDEX CONCURRENTLY` in Postgres).
  - Add nullable columns or columns with default values without table locks.
- **Query Optimization Standards**:
  - Mandate `EXPLAIN (ANALYZE, BUFFERS, COSTS)` on slow queries.
  - Eliminate Sequential Scans on tables with > 10,000 rows.
  - Design composite, partial, and covering indexes to satisfy queries with Index Only Scans.
- **Connection & Resource Pooling**:
  - Deploy PgBouncer / ProxySQL to eliminate connection thrashing.
  - Configure statement timeouts (`statement_timeout = '30s'`) and lock timeouts to prevent cascade outages.
- **Transaction Safety**: Choose appropriate isolation levels; prevent phantom reads and serialization anomalies.

## 3. Testing Standards
- Schema migration rollback verification tests (Up & Down migrations).
- Concurrency race conditions and transaction deadlock simulation tests.
