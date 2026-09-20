# 自研 VFS 存储后端微基准报告

生成时间：2026-09-20T14:01:40.314111+00:00

方法：文件数 20，每操作预热 1 轮 + 计时 20 轮，报告中位数与 P95；每个 (后端, 大小) 组合先通过正确性闸门。

| backend | size | op | median (ms) | p95 (ms) |
|---|---|---|---|---|
| memory | small(~1KB) | write | 0.005 | 0.006 |
| memory | small(~1KB) | read | 0.005 | 0.010 |
| memory | small(~1KB) | edit | 0.004 | 0.005 |
| memory | small(~1KB) | grep | 0.059 | 0.069 |
| memory | small(~1KB) | glob | 0.034 | 0.056 |
| memory | small(~1KB) | ls | 0.008 | 0.010 |
| memory | medium(~50KB) | write | 0.005 | 0.008 |
| memory | medium(~50KB) | read | 0.041 | 0.056 |
| memory | medium(~50KB) | edit | 0.028 | 0.044 |
| memory | medium(~50KB) | grep | 0.184 | 0.214 |
| memory | medium(~50KB) | glob | 0.034 | 0.051 |
| memory | medium(~50KB) | ls | 0.008 | 0.020 |
| memory | large(~500KB) | write | 0.005 | 0.009 |
| memory | large(~500KB) | read | 0.295 | 0.313 |
| memory | large(~500KB) | edit | 0.240 | 0.252 |
| memory | large(~500KB) | grep | 0.403 | 0.588 |
| memory | large(~500KB) | glob | 0.034 | 0.050 |
| memory | large(~500KB) | ls | 0.011 | 0.013 |
| sqlite | small(~1KB) | write | 2.594 | 2.796 |
| sqlite | small(~1KB) | read | 0.013 | 0.026 |
| sqlite | small(~1KB) | edit | 2.563 | 2.700 |
| sqlite | small(~1KB) | grep | 0.185 | 0.253 |
| sqlite | small(~1KB) | glob | 0.213 | 0.237 |
| sqlite | small(~1KB) | ls | 0.015 | 0.016 |
| sqlite | medium(~50KB) | write | 2.571 | 2.814 |
| sqlite | medium(~50KB) | read | 0.063 | 0.088 |
| sqlite | medium(~50KB) | edit | 1.050 | 1.127 |
| sqlite | medium(~50KB) | grep | 0.510 | 0.641 |
| sqlite | medium(~50KB) | glob | 0.618 | 0.798 |
| sqlite | medium(~50KB) | ls | 0.015 | 0.028 |
| sqlite | large(~500KB) | write | 1.672 | 2.573 |
| sqlite | large(~500KB) | read | 0.342 | 0.375 |
| sqlite | large(~500KB) | edit | 1.984 | 3.108 |
| sqlite | large(~500KB) | grep | 7.469 | 8.326 |
| sqlite | large(~500KB) | glob | 9.485 | 10.386 |
| sqlite | large(~500KB) | ls | 0.020 | 0.066 |
| disk | small(~1KB) | write | 0.687 | 0.850 |
| disk | small(~1KB) | read | 0.053 | 0.093 |
| disk | small(~1KB) | edit | 0.164 | 0.213 |
| disk | small(~1KB) | grep | 1.666 | 1.845 |
| disk | small(~1KB) | glob | 2.587 | 3.370 |
| disk | small(~1KB) | ls | 0.597 | 0.782 |
| disk | medium(~50KB) | write | 0.720 | 0.779 |
| disk | medium(~50KB) | read | 0.098 | 0.113 |
| disk | medium(~50KB) | edit | 0.248 | 0.476 |
| disk | medium(~50KB) | grep | 1.945 | 2.347 |
| disk | medium(~50KB) | glob | 2.815 | 3.325 |
| disk | medium(~50KB) | ls | 0.562 | 0.750 |
| disk | large(~500KB) | write | 1.024 | 1.401 |
| disk | large(~500KB) | read | 0.407 | 0.448 |
| disk | large(~500KB) | edit | 1.206 | 1.471 |
| disk | large(~500KB) | grep | 8.264 | 9.618 |
| disk | large(~500KB) | glob | 10.546 | 11.206 |
| disk | large(~500KB) | ls | 0.548 | 0.632 |

## 结论

- small(~1KB) / edit：最快 memory（中位数 0.004 ms）
- small(~1KB) / glob：最快 memory（中位数 0.034 ms）
- small(~1KB) / grep：最快 memory（中位数 0.059 ms）
- small(~1KB) / ls：最快 memory（中位数 0.008 ms）
- small(~1KB) / read：最快 memory（中位数 0.005 ms）
- small(~1KB) / write：最快 memory（中位数 0.005 ms）
- medium(~50KB) / edit：最快 memory（中位数 0.028 ms）
- medium(~50KB) / glob：最快 memory（中位数 0.034 ms）
- medium(~50KB) / grep：最快 memory（中位数 0.184 ms）
- medium(~50KB) / ls：最快 memory（中位数 0.008 ms）
- medium(~50KB) / read：最快 memory（中位数 0.041 ms）
- medium(~50KB) / write：最快 memory（中位数 0.005 ms）
- large(~500KB) / edit：最快 memory（中位数 0.240 ms）
- large(~500KB) / glob：最快 memory（中位数 0.034 ms）
- large(~500KB) / grep：最快 memory（中位数 0.403 ms）
- large(~500KB) / ls：最快 memory（中位数 0.011 ms）
- large(~500KB) / read：最快 memory（中位数 0.295 ms）
- large(~500KB) / write：最快 memory（中位数 0.005 ms）

预期模式：memory 无 IO 开销最快；disk 受文件系统调用主导；sqlite 每次写提交事务，写放大最明显。glob 等枚举类操作受全量 keys()/rglob 扫描主导；grep 基准已加 max_count 截断，match 物化成本有界，开销同样以扫描为主。具体数字以上表为准。
