# Work Report Backend API

本文档记录当前已经完成的接口、工序导入格式，以及其他后端系统调用导入接口时的签名方式。

## 基础信息

- 默认服务端口：`8080`
- JSON 请求体大小限制：`10mb`
- 除 `GET /health` 外，接口默认需要认证。
- 普通业务接口使用 `Authorization: Bearer <token>` 或 `auth_token` Cookie。
- 后端对后端导入接口也支持专用 HMAC 签名，见下文“后端导入签名”。

## 环境变量

```env
DATABASE_URL="postgresql://user:password@localhost:5432/work_report"
AUTH_API_BASE_URL="http://hz.jc-times.com:2000/"
PORT=8080
CORS_ORIGIN="http://localhost:5173,https://app.xinfatech.xyz:2011"
CORS_CREDENTIALS=true
AUTH_COOKIE_NAME=auth_token
AUTH_CACHE_TTL_SECONDS=300
ALLOW_MOCK_TOKEN=false
MOCK_AUTH_TOKEN=mock-token
MOCK_USER_ID=demo-worker
MOCK_USER_NAME=张师傅
MOCK_USER_ROLES=worker

# 后端对后端导入接口签名
IMPORT_API_KEY=
IMPORT_API_SECRET=
IMPORT_SIGNATURE_TTL_SECONDS=300
```

`IMPORT_API_SECRET` 只在服务端保存，不要发给前端、客户端或第三方页面。

`CORS_ORIGIN` 支持多个地址，用英文逗号分隔。地址需要和浏览器请求里的 Origin 完全一致，包括协议、域名和端口。

## 角色和能力

当前能力由用户角色推导：

| 角色 | 能力 |
| --- | --- |
| `worker` | 查看/领取/取消自己领取的工序，查看自己的统计 |
| `leader` | `worker` 能力，加上查看管理信息、导入工序、查看异常 |
| `admin` | 所有管理能力，包括分配员工、强制移除分配 |

前端不要直接写死角色判断，建议登录后调用 `GET /me/capabilities`，用返回的能力字段控制页面入口、按钮和接口调用。后端仍会在受保护接口上做权限校验，前端隐藏入口只是改善体验。

## 后端导入签名

`POST /api/operations/import` 和 `POST /leader/operations/import` 支持其他后端系统调用。推荐第三方系统调用 `/api/operations/import`，并使用 HTTPS + HMAC-SHA256 签名：

- HTTPS 负责传输加密。
- HMAC 负责确认调用方身份、请求体未被篡改、请求没有过期。

### 请求头

```text
X-Import-Key: <IMPORT_API_KEY>
X-Import-Timestamp: <毫秒级 Unix 时间戳>
X-Import-Nonce: <8-128 位随机字符串>
X-Import-Signature: <hex 编码的 HMAC-SHA256 签名>
Content-Type: application/json
```

### 签名原文

```text
<timestamp>.<nonce>.<rawBody>
```

注意：`rawBody` 必须是最终发送出去的 JSON 字符串原文，不能用解析后的对象重新拼。签名时用什么字符串，请求发送时就必须发送完全相同的字符串。

### 签名算法

```text
signature = HMAC_SHA256_HEX(secret = IMPORT_API_SECRET, message = `${timestamp}.${nonce}.${rawBody}`)
```

服务端默认允许时间偏差 `300` 秒，可通过 `IMPORT_SIGNATURE_TTL_SECONDS` 调整。超时请求会返回 `401`。同一个 `nonce` 在有效期内只能使用一次，重复请求会返回 `401`。

### Node.js 示例

```ts
import { createHmac, randomUUID } from "node:crypto";

const apiKey = process.env.IMPORT_API_KEY!;
const secret = process.env.IMPORT_API_SECRET!;
const timestamp = Date.now().toString();
const nonce = randomUUID();

const body = JSON.stringify({
  operations: [
    {
      orderNo: "WO-20260625-001",
      productCode: "CP-001",
      productName: "产品A",
      partNo: "1",
      partCode: "PART-001",
      partName: "零件A",
      operationNo: "10",
      operationCode: "OP-010",
      operationName: "粗加工",
      operationNote: "注意装夹方向",
      estimatedHours: 2.5,
      plannedQuantity: 100,
      dueDate: "2026-06-30"
    }
  ]
});

const signature = createHmac("sha256", secret)
  .update(`${timestamp}.${nonce}.${body}`)
  .digest("hex");

const response = await fetch("http://localhost:8080/api/operations/import", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Import-Key": apiKey,
    "X-Import-Timestamp": timestamp,
    "X-Import-Nonce": nonce,
    "X-Import-Signature": signature
  },
  body
});

console.log(response.status, await response.json());
```

### Java 示例

```java
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import java.util.UUID;

String apiKey = System.getenv("IMPORT_API_KEY");
String secret = System.getenv("IMPORT_API_SECRET");
String timestamp = String.valueOf(System.currentTimeMillis());
String nonce = UUID.randomUUID().toString();
String body = "{\"operations\":[{\"orderNo\":\"WO-20260625-001\",\"productCode\":\"CP-001\",\"productName\":\"产品A\",\"partNo\":\"1\",\"partCode\":\"PART-001\",\"partName\":\"零件A\",\"operationNo\":\"10\",\"operationCode\":\"OP-010\",\"operationName\":\"粗加工\",\"estimatedHours\":2.5,\"plannedQuantity\":100,\"dueDate\":\"2026-06-30\"}]}";

Mac mac = Mac.getInstance("HmacSHA256");
mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
byte[] digest = mac.doFinal((timestamp + "." + nonce + "." + body).getBytes(StandardCharsets.UTF_8));
String signature = HexFormat.of().formatHex(digest);

// 请求头：
// Content-Type: application/json
// X-Import-Key: apiKey
// X-Import-Timestamp: timestamp
// X-Import-Nonce: nonce
// X-Import-Signature: signature
```

## 已完成接口

### 健康检查

```http
GET /health
```

响应：

```json
{ "ok": true }
```

### 当前用户能力

```http
GET /me/capabilities
```

响应示例：

```json
{
  "roles": ["leader"],
  "canViewAdmin": true,
  "canAssignWorkers": false,
  "canReviewExceptions": true,
  "canImportOperations": true,
  "canViewTeamOperations": true,
  "canForceRemoveAssignments": false,
  "canViewAllTeams": false
}
```

前端建议缓存该响应到全局状态，并在刷新页面时重新拉取一次。常用映射：

| 能力 | 前端用途 |
| --- | --- |
| `canViewAdmin` | 显示管理端入口、工单列表入口 |
| `canAssignWorkers` | 显示员工搜索、派工相关入口 |
| `canReviewExceptions` | 显示异常列表和处理入口 |
| `canImportOperations` | 显示工序导入入口，允许调用导入接口 |
| `canViewTeamOperations` | 显示班组/团队工序视图入口 |
| `canForceRemoveAssignments` | 显示强制移除分配按钮 |
| `canViewAllTeams` | 显示全班组筛选或全局视图 |

### 我的工序任务

```http
GET /assignments
```

返回当前用户未完成、未取消的工序任务。

### 可领取产品

```http
GET /claim/products?keyword=<关键字>
```

返回有可领取工序的工单/产品列表。`keyword` 可匹配工单号、产品编码、产品名称。

响应字段：

```json
[
  {
    "id": "workOrderId",
    "orderNo": "WO-20260625-001",
    "productCode": "CP-001",
    "productName": "产品A",
    "remainingQuantity": 100
  }
]
```

### 可领取零件

```http
GET /claim/products/:productId/parts
```

响应字段：

```json
[
  {
    "id": "partId",
    "productId": "workOrderId",
    "partNo": "1",
    "partCode": "PART-001",
    "partName": "零件A",
    "operationCount": 2,
    "remainingQuantity": 100
  }
]
```

### 可领取工序

```http
GET /claim/parts/:partId/operations
```

响应字段：

```json
[
  {
    "id": "operationId",
    "productId": "workOrderId",
    "partId": "partId",
    "orderNo": "WO-20260625-001",
    "productCode": "CP-001",
    "productName": "产品A",
    "partNo": "1",
    "partCode": "PART-001",
    "partName": "零件A",
    "operationNo": "10",
    "operationCode": "OP-010",
    "operationName": "粗加工",
    "operationNote": "",
    "plannedQuantity": 100,
    "plannedStart": "2026-06-25T01:00:00.000Z",
    "estimatedHours": 2.5,
    "claimedWorkers": 0,
    "maxClaimWorkers": 2,
    "status": "available"
  }
]
```

这里的 `id` 是系统生成的工序 ID；`operationCode` 是业务工序编号。同一个工单、同一个零件下，`operationCode` 唯一。

### 领取工序

```http
POST /claim/operations/:operationId/claim
```

创建当前用户的工序任务，并增加工序领取人数。

常见错误：

| 状态码 | 含义 |
| --- | --- |
| `404` | 工序不存在 |
| `409` | 工序不可领取、人数已满，或用户重复领取 |

### 取消自己领取的工序

```http
DELETE /assignments/:assignmentId/claim
```

只有自己领取、尚未开始、允许移除的工序任务可取消。

成功响应：`204 No Content`

### 我的统计

```http
GET /statistics/me?period=day|week|month
```

响应示例：

```json
{
  "period": "week",
  "totalHours": 5.5,
  "regularHours": 5.5,
  "overtimeHours": 0,
  "completedOperations": 3,
  "attendanceDays": 2,
  "trend": []
}
```

### 管理端工单列表

```http
GET /admin/orders?page=1&pageSize=50
```

需要 `canViewAdmin`。

响应字段：

```json
{
  "items": [
    {
      "id": "workOrderId",
      "orderNo": "WO-20260625-001",
      "productCode": "CP-001",
      "productName": "产品A",
      "plannedQuantity": 100,
      "completedQuantity": 20,
      "dueDate": "2026-06-30",
      "progress": 20,
      "status": "in_progress"
    }
  ],
  "hasMore": false
}
```

### 管理端员工搜索

```http
GET /admin/workers?keyword=<关键字>&page=1&pageSize=20
```

需要 `canAssignWorkers`。

响应字段：

```json
{
  "items": [
    {
      "id": "workerId",
      "employeeNo": "EMP-001",
      "name": "张师傅",
      "nameInitials": "zsf",
      "teamName": "生产一组",
      "activeAssignmentCount": 2
    }
  ],
  "hasMore": false
}
```

### 工序导入

```http
POST /leader/operations/import
```

```http
POST /api/operations/import
```

需要 `canImportOperations`，或者使用“后端导入签名”。第三方系统推荐调用 `/api/operations/import`；前端管理页面可以继续调用 `/leader/operations/import`。
单次最多导入 `40000` 条工序。服务端按 `1000` 条一批写入数据库。

`/api/operations/import` 支持对象：

```json
{
  "operations": [
    {
      "orderNo": "WO-20260625-001",
      "productCode": "CP-001",
      "productName": "产品A",
      "partNo": "1",
      "partCode": "PART-001",
      "partName": "零件A",
      "operationNo": "10",
      "operationCode": "OP-010",
      "operationName": "粗加工",
      "operationNote": "注意装夹方向",
      "estimatedHours": 2.5,
      "plannedQuantity": 100,
      "dueDate": "2026-06-30"
    }
  ]
}
```

也支持直接传数组：

```json
[
  {
    "orderNo": "WO-20260625-001",
    "productCode": "CP-001",
    "productName": "产品A",
    "partNo": "1",
    "partCode": "PART-001",
    "partName": "零件A",
    "operationNo": "10",
    "operationCode": "OP-010",
    "operationName": "粗加工",
    "estimatedHours": 2.5,
    "plannedQuantity": 100,
    "dueDate": null
  }
]
```

`/leader/operations/import` 额外兼容旧前端的简化格式：

```json
{
  "rows": [
    {
      "productCode": "CP-001",
      "partCode": "PART-001",
      "operationCode": "OP-010",
      "operationName": "粗加工",
      "quantity": 100,
      "estimatedHours": 2.5
    }
  ]
}
```

该兼容格式会自动映射为第三方导入格式：`orderNo`/`productName` 使用 `productCode`，`partNo`/`partName` 使用 `partCode`，`operationNo` 使用 `operationCode`，`plannedQuantity` 使用 `quantity`，`dueDate` 为 `null`。

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `orderNo` | 是 | 工单号，唯一 |
| `productCode` | 是 | 产品编码 |
| `productName` | 是 | 产品名称 |
| `partNo` | 是 | 零件序号，字符串或数字都会按字符串保存 |
| `partCode` | 是 | 零件编码，同一工单内唯一 |
| `partName` | 是 | 零件名称 |
| `operationNo` | 是 | 工序序号，字符串或数字都会按字符串保存 |
| `operationCode` | 是 | 工序业务编号，同一工单、同一零件下唯一 |
| `operationName` | 是 | 工序名称 |
| `operationNote` | 否 | 工序备注，默认空字符串 |
| `estimatedHours` | 是 | 预计工时，正数 |
| `plannedQuantity` | 否 | 工序计划数量，正数，默认 `1` |
| `dueDate` | 否 | 工单交期，支持 `YYYY-MM-DD`、`YYYY/MM/DD`、`YYYY-MM-DDTHH:mm:ss`、`YYYY-MM-DDTHH:mm:ss.SSSZ`；为空或 `null` 时使用导入当天 |

响应：

```json
{
  "accepted": 1,
  "rejected": 0,
  "items": [
    {
      "row": 1,
      "operationId": "clx...",
      "orderNo": "WO-20260625-001",
      "partCode": "PART-001",
      "operationCode": "OP-010"
    }
  ],
  "errors": []
}
```

导入按批次事务写入：某一批失败会把该批内行写入 `errors`，其他批次不受影响。导入是幂等 upsert：同一个 `orderNo + partCode + operationCode` 再次导入会更新工单、零件和工序信息。导入后的工序状态为 `available`，来源为 `third_party`。

## 已挂载但暂未实现的接口

以下接口当前存在路由，但返回空数据或 `501`，还不能作为完整业务能力使用：

| 接口 | 当前行为 |
| --- | --- |
| `GET /assignments/current` | 返回 `501` |
| `POST /assignments/:id/select` | 返回 `501` |
| `POST /assignments/:id/start` | 返回 `501` |
| `POST /assignments/:id/pause` | 返回 `501` |
| `POST /assignments/:id/resume` | 返回 `501` |
| `POST /assignments/:id/complete` | 返回 `501` |
| `GET /attendance/me` | 返回 `501` |
| `GET /admin/dashboard` | 返回 `501` |
| `GET /admin/reports` | 返回 `501` |
| `GET /admin/exceptions` | 返回 `501` |
| `POST /admin/exceptions/:id/resolve` | 返回 `501` |
| `POST /admin/assignments` | 返回 `501` |
| `DELETE /admin/assignments/:assignmentId` | 返回 `501` |

## 重要数据结构

工序存储在 `OperationPool`：

```ts
{
  id: string;
  workOrderId: string;
  partId: string;
  operationNo?: string | null;
  operationCode: string;
  operationName: string;
  operationNote: string;
  plannedQuantity: number;
  plannedStart?: Date;
  remainingQuantity: number;
  estimatedHours: number;
  claimedWorkers: number;
  maxClaimWorkers?: number | null;
  status: "available" | "claimed" | "closed" | string;
  source: string;
  createdBy?: string | null;
}
```

零件存储在 `WorkOrderPart`，其中 `partNo` 是展示/排序用的零件序号，`partCode` 是同一工单内的业务唯一编码。

唯一约束：

```ts
workOrderId + partId + operationCode
```

所以系统工序 ID 是 `id`，外部业务系统更适合用 `orderNo + partCode + operationCode` 作为幂等导入键。`partNo` 和 `operationNo` 会返回给前端用于展示和数字排序，但不参与唯一约束。
