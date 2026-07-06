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
AUTH_COOKIE_SECURE=false
AUTH_CACHE_TTL_SECONDS=300
JWT_SECRET=
AUTH_TOKEN_TTL=30m
AUTH_CLIENT_IDS=work-report
WECHAT_AUTH_ALLOWED_ORIGINS="http://localhost:5173,https://app.xinfatech.xyz:2011"
WECHAT_PROXY_HOST="http://122.226.146.110:780"
WECHAT_PROXY_CRYPTO_SECRET=
WECOM_CLIENT_ID=work-report
WECOM_CORP_ID=
WECOM_AGENT_ID=
WECOM_CORP_SECRET=
WECOM_CONTACT_CORP_SECRET=
ALLOW_MOCK_TOKEN=false
MOCK_AUTH_TOKEN=mock-token
MOCK_USER_ID=demo-worker
MOCK_USER_NAME=张师傅
MOCK_USER_ROLES=worker

# 后端对后端导入接口签名
IMPORT_API_KEY=
IMPORT_API_SECRET=
IMPORT_SIGNATURE_TTL_SECONDS=300

# 薪福通默认配置，可在前端管理页保存覆盖
XFT_HOST="https://api.cmbchina.com"
XFT_APPID=
XFT_AUTHORITY_SECRET=
XFT_ENTERPRISE_ID=
```

`IMPORT_API_SECRET` 只在服务端保存，不要发给前端、客户端或第三方页面。

`CORS_ORIGIN` 支持多个地址，用英文逗号分隔。地址需要和浏览器请求里的 Origin 完全一致，包括协议、域名和端口。

`JWT_SECRET` 用于本后端签发和校验登录 token。要让前端的 `VITE_AUTH_API_BASE_URL` 指向本服务，前后端调用的后端实例需要配置相同的 `JWT_SECRET`。`AUTH_CLIENT_IDS` 默认是单客户端 `work-report`。

企业微信登录还需要配置认证客户端。推荐在服务根目录放 `wechat.json`，格式见 [wechat.example.json](../wechat.example.json)：

```json
[
  {
    "corpId": "wwxxxxxxxxxxxxxxxx",
    "name": "jctimes",
    "apps": [
      {
        "agentId": 1000044,
        "corpSecret": "replace-with-login-secret",
        "contactCorpSecret": "replace-with-address-book-secret",
        "name": "work-report",
        "clientId": "work-report",
        "allowedOrigins": ["https://app.example.com"],
        "scopes": []
      }
    ]
  }
]
```

也可以用 `WECHAT_AUTH_CLIENTS` 放同样的 JSON。`corpSecret` 用于企业微信登录、OAuth code 换 token；`contactCorpSecret` 用于创建、更新、删除、邀请成员和获取加入二维码等通讯录接口，必须配置为“通讯录同步”或具备通讯录权限的 Secret。简单部署时可直接配置 `WECOM_CLIENT_ID=work-report`、`WECOM_CORP_ID`、`WECOM_AGENT_ID`、`WECOM_CORP_SECRET`、`WECOM_CONTACT_CORP_SECRET`。

兼容说明：旧前端如果仍传 `clientId=legacy-frontend` 或 `clientId=new-frontend`，后端会映射到 `work-report`；旧的 `WECOM_LEGACY_*`、`WECOM_NEW_*` 环境变量也会作为兜底读取，但新部署不建议继续使用。

`WECHAT_AUTH_ALLOWED_ORIGINS` 是登录接口允许的浏览器 Origin，多个地址用英文逗号分隔；也可以在 `wechat.json` 每个 app 的 `allowedOrigins` 单独配置。`AUTH_COOKIE_SECURE=true` 时 Cookie 只会在 HTTPS 下写入，开发环境通常设为 `false`。

如果当前服务器出口 IP 没有加入企业微信可信 IP，需要像参考 `jdy_backend/src/api/jctimes` 一样走 jctimes 微信代理。配置 `WECHAT_PROXY_HOST` 和 `WECHAT_PROXY_CRYPTO_SECRET` 后，本服务会把 `/cgi-bin/gettoken`、`/cgi-bin/auth/getuserinfo`、`/cgi-bin/auth/getuserdetail`、`/cgi-bin/user/get`、`/cgi-bin/user/create`、`/cgi-bin/user/update`、`/cgi-bin/user/batchdelete`、`/cgi-bin/department/create`、`/cgi-bin/department/update`、`/cgi-bin/department/delete`、`/cgi-bin/department/simplelist`、`/cgi-bin/user/list_id`、`/cgi-bin/batch/invite`、`/cgi-bin/corp/get_join_qrcode` 通过 `POST <WECHAT_PROXY_HOST>/wechat/proxy` 转发，协议为 AES-256-GCM 加密 JSON，和参考项目一致。未配置 `WECHAT_PROXY_CRYPTO_SECRET` 时才会直连 `WECOM_API_BASE_URL`。

## 身份验证接口

### 企业微信 code 换 token

```http
POST /auth/wecom/token
```

请求体：

```json
{
  "code": "企业微信 OAuth code"
}
```

响应：

```json
{
  "token": "jwt...",
  "user": {
    "userId": "LiangZhi",
    "corpId": "wwxxxxxxxxxxxxxxxx",
    "clientId": "work-report",
    "name": "梁之",
    "avatar": "https://..."
  }
}
```

服务端会同时写入 `auth_token` Cookie。前端也可以使用响应里的 `token` 作为 `Authorization: Bearer <token>`。

旧前端兼容接口：

```http
POST /auth/token
```

请求体只需要 `{ "code": "企业微信 OAuth code" }`，默认使用 `work-report` 客户端。

### 当前登录用户

```http
GET /auth/me
```

支持 `Authorization: Bearer <token>` 或 `auth_token` Cookie。服务端会优先按本地 JWT 校验；若不是本地 JWT，则回落到 `AUTH_API_BASE_URL/auth/me`。

响应示例：

```json
{
  "userId": "worker-1",
  "name": "张师傅",
  "avatar": null,
  "roles": ["worker"],
  "capabilities": {
    "roles": ["worker"],
    "canViewAdmin": false,
    "canAssignWorkers": false,
    "canReviewExceptions": false,
    "canImportOperations": false,
    "canViewTeamOperations": false,
    "canForceRemoveAssignments": false,
    "canViewAllTeams": false
  }
}
```

### 退出登录

```http
POST /auth/logout
```

清除 `auth_token` Cookie，成功返回 `204 No Content`。

## 企业微信通讯录管理

以下接口需要管理员登录态，支持 `Authorization: Bearer <token>` 或 `auth_token` Cookie。企业微信侧会使用当前 `clientId` 配置里的 `contactCorpSecret`，或简单 env 模式下的 `WECOM_CONTACT_CORP_SECRET`，获取通讯录专用 access_token；未配置时接口返回 `WECOM_CONTACT_CORP_SECRET_MISSING`。

### 创建企业微信成员

```http
POST /auth/admin/wecom/users
```

请求体支持两种格式。推荐把企业微信原始字段放在 `user` 内：

```json
{
  "user": {
    "userid": "zhangsan",
    "name": "张三",
    "alias": "jackzhang",
    "mobile": "13800000000",
    "department": [1, 2],
    "order": [10, 40],
    "position": "产品经理",
    "gender": "1",
    "email": "zhangsan@example.com",
    "biz_mail": "zhangsan@corp.example.com",
    "telephone": "020-123456",
    "is_leader_in_dept": [1, 0],
    "direct_leader": ["lisi"],
    "enable": 1
  }
}
```

也兼容把 `userid`、`name` 等企业微信字段直接放在请求体顶层。服务端会透传给企业微信 `POST /cgi-bin/user/create`，仅校验 `userid` 和 `name` 非空。

成功响应：

```json
{
  "errcode": 0,
  "errmsg": "created",
  "createdDepartmentList": {
    "department_info": [
      {
        "name": "生产部",
        "id": 123
      }
    ]
  }
}
```

### 更新企业微信成员

```http
PATCH /auth/admin/wecom/users/:userid
```

请求体推荐把企业微信原始字段放在 `user` 内。路径里的 `:userid` 会作为默认 `userid`，也可以在 `user.userid` 中显式传入。

```json
{
  "user": {
    "name": "李四",
    "department": [1],
    "order": [10],
    "position": "后台工程师",
    "mobile": "13800000000",
    "gender": "1",
    "email": "zhangsan@qq.com",
    "biz_mail": "zhangsan@tencent.com",
    "biz_mail_alias": {
      "item": ["jack@tencent.com", "hr@tencent.com"]
    },
    "is_leader_in_dept": [1],
    "direct_leader": ["lisi"],
    "enable": 1,
    "telephone": "020-123456",
    "alias": "jackzhang",
    "address": "广州市海珠区新港中路",
    "main_department": 1
  }
}
```

服务端会透传给企业微信 `POST /cgi-bin/user/update`，仅校验最终 `userid` 非空。

成功响应：

```json
{
  "errcode": 0,
  "errmsg": "updated"
}
```

### 批量删除企业微信成员

```http
POST /auth/admin/wecom/users/batch-delete
```

请求体：

```json
{
  "useridlist": ["zhangsan", "lisi"]
}
```

`useridlist` 最多 200 个。成功响应：

```json
{
  "errcode": 0,
  "errmsg": "deleted"
}
```

### 创建企业微信部门

```http
POST /auth/admin/wecom/departments
```

请求体支持 `{ "department": { ... } }` 或直接把企业微信字段放在顶层：

```json
{
  "department": {
    "name": "广州研发中心",
    "name_en": "RDGZ",
    "parentid": 1,
    "order": 1,
    "id": 2
  }
}
```

服务端会调用企业微信 `POST /cgi-bin/department/create`，成功后同步写入本地 `wecom_departments` 表。成功响应：

```json
{
  "errcode": 0,
  "errmsg": "created",
  "id": 2
}
```

### 更新企业微信部门

```http
PATCH /auth/admin/wecom/departments/:id
```

请求体推荐把企业微信字段放在 `department` 内。路径里的 `:id` 会作为默认部门 id：

```json
{
  "department": {
    "name": "广州研发中心",
    "name_en": "RDGZ",
    "parentid": 1,
    "order": 1
  }
}
```

成功后同步更新本地 `wecom_departments` 表。成功响应：

```json
{
  "errcode": 0,
  "errmsg": "updated"
}
```

### 删除企业微信部门

```http
DELETE /auth/admin/wecom/departments/:id
```

查询参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `clientId` | 否 | 企业微信配置客户端，默认 `work-report` |

成功后同步删除本地部门及其用户-部门关系。成功响应：

```json
{
  "errcode": 0,
  "errmsg": "deleted"
}
```

### 获取并同步单个部门详情

```http
GET /auth/admin/wecom/departments/:id
```

服务端调用企业微信 `GET /cgi-bin/department/get`，使用当前 `clientId` 配置里的应用 `corpSecret` 获取 access_token，不使用 `WECOM_CONTACT_CORP_SECRET`。成功后会同步 upsert 到本地 `wecom_departments` 表。

前端部门详情页的“刷新”按钮可直接调用该接口；打开编辑弹窗或进入编辑页前，也应先调用该接口拿最新详情，再把返回的 `department` 填入表单，避免使用本地旧数据编辑。

```json
{
  "errcode": 0,
  "errmsg": "ok",
  "department": {
    "id": 2,
    "name": "广州研发中心",
    "name_en": "RDGZ",
    "department_leader": ["zhangsan", "lisi"],
    "parentid": 1,
    "order": 10
  }
}
```

### 获取并同步部门 ID 列表

```http
GET /auth/admin/wecom/departments/simplelist?id=1
```

不传 `id` 时获取全量组织架构；返回结果会同步 upsert 到本地 `wecom_departments` 表，并逐个调用部门详情接口补齐名称、英文名和负责人。

前端部门列表页的“刷新”按钮应调用该接口。刷新完成后使用响应里的 `departments` 重绘列表，或重新查询本地部门数据。

```json
{
  "errcode": 0,
  "errmsg": "ok",
  "departmentId": [
    {
      "id": 2,
      "parentid": 1,
      "order": 10
    }
  ],
  "department_id": [
    {
      "id": 2,
      "parentid": 1,
      "order": 10
    }
  ],
  "departments": [
    {
      "id": 2,
      "name": "广州研发中心",
      "name_en": "RDGZ",
      "department_leader": ["zhangsan", "lisi"],
      "parentid": 1,
      "order": 10
    }
  ]
}
```

### 获取并同步部门列表（旧接口）

```http
GET /auth/admin/wecom/departments/list?id=1
```

服务端调用企业微信 `GET /cgi-bin/department/list`，使用当前 `clientId` 配置里的应用 `corpSecret` 获取 access_token，并通过微信 proxy 转发；不使用 `WECOM_CONTACT_CORP_SECRET`。成功后会同步 upsert 到本地 `wecom_departments` 表。

该接口是企业微信性能较低的旧接口，优先使用 `GET /auth/admin/wecom/departments/simplelist` 加单部门详情刷新；仅在需要验证或兼容旧接口时调用。

```json
{
  "errcode": 0,
  "errmsg": "ok",
  "department": [
    {
      "id": 2,
      "name": "广州研发中心",
      "name_en": "RDGZ",
      "department_leader": ["zhangsan", "lisi"],
      "parentid": 1,
      "order": 10
    }
  ]
}
```

### 获取并同步成员部门关系

```http
POST /auth/admin/wecom/user-departments/list-id
```

调用企业微信 `POST /cgi-bin/user/list_id` 获取单页用户-部门关系，并增量同步到本地 `wecom_user_departments` 表，同时更新已存在本地用户的 `department` 和 `main_department`。

```json
{
  "cursor": "",
  "limit": 10000
}
```

成功响应：

```json
{
  "errcode": 0,
  "errmsg": "ok",
  "nextCursor": "",
  "next_cursor": "",
  "deptUser": [
    {
      "userid": "zhangsan",
      "department": 2
    }
  ],
  "dept_user": [
    {
      "userid": "zhangsan",
      "department": 2
    }
  ]
}
```

需要全量同步时使用：

```http
POST /auth/admin/wecom/user-departments/sync
```

该接口会自动翻页到 `next_cursor` 为空，并以企业微信返回结果替换本地 `wecom_user_departments` 当前客户端的数据。

### 邀请企业微信成员

```http
POST /auth/admin/wecom/invite
```

请求体中 `user`、`party`、`tag` 不能同时为空：

```json
{
  "user": ["UserID1", "UserID2"],
  "party": [1, 2],
  "tag": [101, 102]
}
```

限制：`user` 最多 1000 个，`party` 最多 100 个，`tag` 最多 100 个。成功响应：

```json
{
  "errcode": 0,
  "errmsg": "ok",
  "invalidUser": ["UserID1"],
  "invalidParty": [1],
  "invalidTag": [101],
  "invaliduser": ["UserID1"],
  "invalidparty": [1],
  "invalidtag": [101]
}
```

驼峰字段和企业微信原始字段含义相同，前端优先使用 `invalidUser`、`invalidParty`、`invalidTag`。

### 获取加入企业二维码

```http
GET /auth/admin/wecom/join-qrcode?sizeType=3
```

查询参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `clientId` | 否 | 企业微信配置客户端，默认 `work-report`；单客户端项目通常不需要传 |
| `sizeType` | 否 | 二维码尺寸类型：`1` 为 171 x 171，`2` 为 399 x 399，`3` 为 741 x 741，`4` 为 2052 x 2052；默认 `3` |

成功响应：

```json
{
  "errcode": 0,
  "errmsg": "ok",
  "joinQrcode": "https://work.weixin.qq.com/wework_admin/genqrcode?action=join&...",
  "join_qrcode": "https://work.weixin.qq.com/wework_admin/genqrcode?action=join&...",
  "expiresInDays": 7,
  "sizeType": 3
}
```

`joinQrcode` 和 `join_qrcode` 是同一个链接，前端优先使用 `joinQrcode`。企业微信返回的二维码链接有效期为 7 天，前端展示时不要长期缓存。

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
GET /claim/products?keyword=<关键字>&page=1&pageSize=4
```

返回有可领取工序的工单/产品分页列表。`keyword` 可匹配工单号、产品编码、产品名称，空字符串等同未传。`page` 从 1 开始，默认 1；`pageSize` 默认 4，最大 50。

响应字段：

```json
{
  "items": [
    {
      "id": "workOrderId",
      "orderNo": "WO-20260625-001",
      "productCode": "CP-001",
      "productName": "产品A",
      "remainingQuantity": 100
    }
  ],
  "page": 1,
  "pageSize": 4,
  "total": 123,
  "hasMore": true
}
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
  "hourAllocation": {
    "allocationTemporary": true,
    "method": "actual_duration_ratio",
    "appliedCount": 3,
    "totalCount": 3,
    "items": [
      {
        "assignmentId": "assignment-1",
        "operationPoolId": "operation-1",
        "allocatedHours": 2.5,
        "originalEstimatedHours": 10,
        "allocationApplied": true,
        "allocationTemporary": true,
        "allocationMethod": "actual_duration_ratio",
        "allocationRatio": 0.25,
        "allocationBasisSeconds": 3600,
        "allocationParticipantCount": 2
      }
    ]
  },
  "trend": []
}
```

当前工时分摊为临时口径：同一工序下未取消报工按 `actualEndAt - actualStartAt` 的实际时长占比分配工序标准工时；无有效实际时长时退回原 `estimatedHours`，并通过 `hourAllocation.allocationApplied=false` 标记。

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

### 管理端权限编辑

```http
GET /admin/worker-permissions
```

需要 admin 级能力：`canAssignWorkers && canForceRemoveAssignments && canViewAllTeams`。

响应字段：

```json
[
  {
    "id": "workerId",
    "workerId": "workerId",
    "employeeNo": "EMP-001",
    "name": "张师傅",
    "nameInitials": "zsf",
    "teamName": "生产一组",
    "permissionGroup": "worker",
    "roles": ["worker"]
  }
]
```

```http
PATCH /admin/workers/:workerId/permission
```

需要 admin 级能力：`canAssignWorkers && canForceRemoveAssignments && canViewAllTeams`。

请求体：

```json
{ "permissionGroup": "worker" }
```

`permissionGroup` 可选值：`worker`、`leader`、`admin`。

响应为更新后的 `WorkerPermission`：

```json
{
  "id": "workerId",
  "workerId": "workerId",
  "employeeNo": "EMP-001",
  "name": "张师傅",
  "nameInitials": "zsf",
  "teamName": "生产一组",
  "permissionGroup": "leader",
  "roles": ["leader"]
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

### 薪福通配置与工时导入

以下接口需要 `canImportOperations`。

```http
GET /admin/xft/config
PUT /admin/xft/config
```

配置字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `host` | 是 | 薪福通 API 地址，默认 `https://api.cmbchina.com` |
| `appid` | 是 | 应用 ID |
| `appSecret` | 首次必填 | 应用密钥，读取配置时不返回明文；更新时留空表示保留旧值 |
| `enterpriseId` | 是 | 企业 ID |
| `defaultUserId` | 是 | 调用用户号，默认 `U0000` |
| `defaultPlatformUserId` | 是 | 平台用户号，默认 `AUTO0001` |
| `dataCollectionName` | 是 | 采集表名称 |
| `importType` | 是 | 导入类型，例如 `ADD` |
| `salaryPeriod` | 是 | 薪资期间，`YYYYMM` |
| `workHoursFieldKey` | 是 | 工时写入的采集项字段名/字段标识 |
| `isCheckEmpty` | 否 | 是否检查空值 |
| `enabled` | 否 | 是否启用集成 |

```http
POST /admin/xft/import-hours/preview
POST /admin/xft/import-hours
POST /admin/xft/import-hours/manual
```

`/preview` 和 `/import-hours` 请求体：

```json
{ "salaryPeriod": "202606" }
```

后端会按薪资期间汇总 `OperationAssignment`：排除 `cancelled`，优先用 `claimedAt` 匹配期间，`claimedAt` 为空时用 `plannedStart`；员工号来自 `worker.employeeNo`，为空时使用 `workerId`；工时使用临时分摊工时，同一工序下未取消报工按 `actualEndAt - actualStartAt` 的实际时长占比分配工序标准工时，无有效实际时长时退回原 `estimatedHours`。预览行会返回 `hourAllocation`，其中 `allocationTemporary=true` 表示当前是临时分摊口径。

`/manual` 请求体：

```json
{
  "salaryPeriod": "202606",
  "rows": [
    {
      "staffName": "小灰16",
      "staffNumber": "000002",
      "hours": 8,
      "identityNumber": "",
      "staffId": ""
    }
  ]
}
```

导入薪福通时会调用 `/sal/a/xft-sly/salary/api/import-collection-data`，`collectionData` 为 JSON 字符串，例如 `{"WORK_HOURS":8}`。

响应：

```json
{
  "accepted": 1,
  "rejected": 0,
  "items": [{ "lineId": 1, "staffName": "小灰16", "staffNumber": "000002", "hours": 8 }],
  "errors": []
}
```

## 管理端报工记录

### 查询报工记录

```http
GET /admin/reports
```

需要 `admin` 或 `leader` 权限。支持查询参数：

| 参数 | 说明 |
| --- | --- |
| `keyword` | 在工单号、产品名、零件、工序、员工姓名中模糊搜索 |
| `orderNo` | 按工单号模糊搜索 |
| `operatorName` | 按操作人姓名模糊搜索 |
| `status` | 按报工状态精确筛选 |
| `operationCode` | 按工序编号模糊搜索 |
| `operationName` | 按工序名称模糊搜索 |
| `startTime` | `claimedAt >= startTime` |
| `endTime` | 日期格式按当天结束；日期时间格式作为精确上界 |
| `page` | 页码，默认 `1` |
| `pageSize` | 每页数量，默认 `50`，最大 `100` |

响应：

```json
{
  "items": [
    {
      "id": "assignment-1",
      "orderNo": "WO-001",
      "productName": "产品A",
      "partCode": "P-001",
      "partName": "零件A",
      "operationCode": "OP-001",
      "operationName": "粗加工",
      "operatorName": "张师傅",
      "status": "completed",
      "claimedAt": "2026-07-01T01:00:00.000Z",
      "estimatedHours": 2,
      "allocatedHours": 2,
      "originalEstimatedHours": 2,
      "hourAllocation": {
        "allocatedHours": 2,
        "originalEstimatedHours": 2,
        "allocationApplied": true,
        "allocationTemporary": true,
        "allocationMethod": "actual_duration_ratio",
        "allocationRatio": 1,
        "allocationBasisSeconds": 7200,
        "allocationParticipantCount": 1
      },
      "durationHours": 2,
      "startedAt": "2026-07-01T01:00:00.000Z",
      "completedAt": "2026-07-01T03:00:00.000Z",
      "actualStartAt": "2026-07-01T01:00:00.000Z",
      "actualEndAt": "2026-07-01T03:00:00.000Z",
      "photos": []
    }
  ],
  "page": 1,
  "pageSize": 50,
  "total": 1,
  "hasMore": false
}
```

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
