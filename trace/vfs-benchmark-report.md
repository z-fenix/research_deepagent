# 自研 VFS 存储后端微基准报告

生成时间：2026-09-20T13:33:23.429383+00:00

方法：文件数 20，每操作预热 1 轮 + 计时 20 轮，报告中位数与 P95；每个 (后端, 大小) 组合先通过正确性闸门。

| backend | size | op | median (ms) | p95 (ms) |
|---|---|---|---|---|
| memory | small(~1KB) | write | 0.004 | 0.007 |
| memory | small(~1KB) | read | 0.005 | 0.006 |
| memory | small(~1KB) | edit | 0.005 | 0.006 |
| memory | small(~1KB) | grep | 0.062 | 0.094 |
| memory | small(~1KB) | glob | 0.042 | 0.048 |
| memory | small(~1KB) | ls | 0.010 | 0.012 |
| memory | medium(~50KB) | write | 0.004 | 0.005 |
| memory | medium(~50KB) | read | 0.042 | 0.056 |
| memory | medium(~50KB) | edit | 0.028 | 0.032 |
| memory | medium(~50KB) | grep | 4.230 | 5.020 |
| memory | medium(~50KB) | glob | 0.035 | 0.040 |
| memory | medium(~50KB) | ls | 0.008 | 0.010 |
| memory | large(~500KB) | write | 0.004 | 0.014 |
| memory | large(~500KB) | read | 0.308 | 0.346 |
| memory | large(~500KB) | edit | 0.242 | 0.372 |
| memory | large(~500KB) | grep | 69.901 | 84.339 |
| memory | large(~500KB) | glob | 0.034 | 0.044 |
| memory | large(~500KB) | ls | 0.008 | 0.010 |
| sqlite | small(~1KB) | write | 2.335 | 2.613 |
| sqlite | small(~1KB) | read | 0.010 | 0.015 |
| sqlite | small(~1KB) | edit | 2.296 | 2.571 |
| sqlite | small(~1KB) | grep | 0.177 | 0.230 |
| sqlite | small(~1KB) | glob | 0.223 | 0.273 |
| sqlite | small(~1KB) | ls | 0.018 | 0.052 |
| sqlite | medium(~50KB) | write | 2.375 | 2.561 |
| sqlite | medium(~50KB) | read | 0.052 | 0.103 |
| sqlite | medium(~50KB) | edit | 1.176 | 1.286 |
| sqlite | medium(~50KB) | grep | 3.847 | 5.813 |
| sqlite | medium(~50KB) | glob | 0.845 | 1.384 |
| sqlite | medium(~50KB) | ls | 0.015 | 0.029 |
| sqlite | large(~500KB) | write | 1.932 | 2.955 |
| sqlite | large(~500KB) | read | 0.350 | 0.449 |
| sqlite | large(~500KB) | edit | 2.287 | 3.921 |
| sqlite | large(~500KB) | grep | 73.039 | 82.695 |
| sqlite | large(~500KB) | glob | 5.102 | 5.744 |
| sqlite | large(~500KB) | ls | 0.018 | 0.021 |
| disk | small(~1KB) | write | 0.126 | 0.160 |
| disk | small(~1KB) | read | 0.053 | 0.087 |
| disk | small(~1KB) | edit | 0.166 | 0.239 |
| disk | small(~1KB) | grep | 1.707 | 1.817 |
| disk | small(~1KB) | glob | 2.741 | 3.197 |
| disk | small(~1KB) | ls | 0.586 | 0.719 |
| disk | medium(~50KB) | write | 0.163 | 0.199 |
| disk | medium(~50KB) | read | 0.102 | 0.140 |
| disk | medium(~50KB) | edit | 0.278 | 0.599 |
| disk | medium(~50KB) | grep | 5.468 | 6.931 |
| disk | medium(~50KB) | glob | 3.190 | 3.941 |
| disk | medium(~50KB) | ls | 0.623 | 0.875 |
| disk | large(~500KB) | write | 0.492 | 0.629 |
| disk | large(~500KB) | read | 0.427 | 0.697 |
| disk | large(~500KB) | edit | 1.313 | 1.933 |
| disk | large(~500KB) | grep | 74.195 | 76.612 |
| disk | large(~500KB) | glob | 6.824 | 7.609 |
| disk | large(~500KB) | ls | 0.585 | 0.632 |

## 结论

- small(~1KB) / edit：最快 memory（中位数 0.005 ms）
- small(~1KB) / glob：最快 memory（中位数 0.042 ms）
- small(~1KB) / grep：最快 memory（中位数 0.062 ms）
- small(~1KB) / ls：最快 memory（中位数 0.010 ms）
- small(~1KB) / read：最快 memory（中位数 0.005 ms）
- small(~1KB) / write：最快 memory（中位数 0.004 ms）
- medium(~50KB) / edit：最快 memory（中位数 0.028 ms）
- medium(~50KB) / glob：最快 memory（中位数 0.035 ms）
- medium(~50KB) / grep：最快 sqlite（中位数 3.847 ms）
- medium(~50KB) / ls：最快 memory（中位数 0.008 ms）
- medium(~50KB) / read：最快 memory（中位数 0.042 ms）
- medium(~50KB) / write：最快 memory（中位数 0.004 ms）
- large(~500KB) / edit：最快 memory（中位数 0.242 ms）
- large(~500KB) / glob：最快 memory（中位数 0.034 ms）
- large(~500KB) / grep：最快 memory（中位数 69.901 ms）
- large(~500KB) / ls：最快 memory（中位数 0.008 ms）
- large(~500KB) / read：最快 memory（中位数 0.308 ms）
- large(~500KB) / write：最快 memory（中位数 0.004 ms）

预期模式：memory 无 IO 开销最快；disk 受文件系统调用主导；sqlite 每次写提交事务，写放大最明显，但 grep/glob 等枚举类操作与 disk 同受全量 keys() 扫描主导。具体数字以上表为准。
