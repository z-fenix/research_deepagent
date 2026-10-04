// 客户端分词搜索索引（spec §5.4；参照 TrajectorySearchIndex 语义，3s 节流
// 在消费端 TrajectoryView 完成）。

export type SearchEntry = { key: string; text: string };

export class TrajectorySearchIndex {
  private tokens = new Map<string, Set<string>>();

  update(rows: SearchEntry[]): void {
    this.tokens.clear();
    for (const row of rows) {
      const normalized = row.text.toLowerCase();
      for (const token of normalized.split(/[^a-z0-9一-鿿]+/)) {
        if (token === "") continue;
        let bucket = this.tokens.get(token);
        if (bucket === undefined) {
          bucket = new Set();
          this.tokens.set(token, bucket);
        }
        bucket.add(row.key);
      }
    }
  }

  /** 空 query → null（不过滤）；否则返回命中行 key 集合。 */
  search(query: string): Set<string> | null {
    const normalized = query.trim().toLowerCase();
    if (normalized === "") return null;
    const hits = new Set<string>();
    for (const token of normalized.split(/\s+/)) {
      const bucket = this.tokens.get(token);
      if (bucket === undefined) continue;
      for (const key of bucket) hits.add(key);
    }
    return hits;
  }
}
