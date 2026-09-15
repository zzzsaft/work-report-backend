# Work Report Backend

工序报工后端服务。

## 常用命令

```bash
npm install
npm run prisma:generate
npm run dev
npm run build
npm test
```

## 原料字段迁移失败恢复

如果迁移 `20260915100000_add_operation_raw_material_fields` 报 `42701`（`ylpartnum` 已存在），可能是先执行过独立补字段脚本。此迁移已改为使用 `ADD COLUMN IF NOT EXISTS`，保留已有列及其数据，并补齐缺少的列。

将修复后的迁移文件同步到报错环境后，在连接该数据库的应用目录执行：

```bash
npx prisma migrate status
```

仅当上述迁移已被记录为失败时，执行以下命令将失败记录标记为可重试，再重新部署迁移：

```bash
npx prisma migrate resolve --rolled-back 20260915100000_add_operation_raw_material_fields
npm run prisma:deploy
npx prisma migrate status
```

如果迁移尚未执行，直接运行 `npm run prisma:deploy`。如果已成功，不要执行 `resolve --rolled-back`。不要删除已有字段或重置数据库；`--rolled-back` 只更新迁移记录，不撤销已执行的 SQL。已有列仍需确认符合 `schema.prisma` 中的 `TEXT NOT NULL DEFAULT ''` 定义，`IF NOT EXISTS` 不会修正列类型、默认值或空值约束。

## 文档

- [接口文档](docs/API.md)
- 后端对后端调用 `POST /leader/operations/import` 时，请查看接口文档里的“后端导入签名”章节。
