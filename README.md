# 胜算云 dsh 插件

把 LoomLoom Desktop 里的胜算云配置拆出来：浏览器登录或粘贴 API Key，密钥写入 dsh 凭据 `SHENGSUANYUN_API_KEY`，聊天走 `https://router.shengsuanyun.com/api/v1`。

设置里会出现「胜算云」。勾上「新建对话改用胜算云」再登录，之后新建的对话用 `deepseek-v4-flash`。已经打开的对话不变。已经手写过的胜算云地址不会被改掉。

左侧会多一个 SkillBot 市场。浏览不用登录；执行前先报价，确认后才会扣费。没有单独配置创作者密钥时，市场用公开目录。

市场只在较新的 dsh 上出现，例如 DSH Desktop。命令行 dsh 0.1.0-rc.6 仍只有登录页。

```bash
dsh plugin --profile web add github:daffffffffffffff/dsh-plugin-shengsuanyun
```

装完后重新打开 dsh。
