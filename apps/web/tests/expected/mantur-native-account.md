## Login

- region "登录漫途账号":
  - heading "登录漫途账号" [level=1]
  - paragraph: 在这里登录，继续你的漫剧创作。
  - text: 邮箱
  - textbox "邮箱"
  - text: 密码
  - textbox "密码"
  - button "显示密码"
  - paragraph: 登录即同意授权此设备使用你的漫途账号。
  - button "登录"
  - button "使用 Google 登录"
  - text: 还没有账号？
  - button "注册账号"
  - button "暂时跳过"
  - paragraph: 模型服务需单独配置，登录账号不代表已配置模型或获得额度。

## Registration validation

- region "注册漫途账号":
  - heading "注册漫途账号" [level=1]
  - paragraph: 提交注册申请，激活后即可登录。
  - text: 邮箱
  - textbox "邮箱": fixture-new@example.com
  - text: 密码
  - textbox "密码": Fixture-only new password
  - button "显示密码"
  - text: 邮箱验证码
  - textbox "邮箱验证码" [invalid]
  - button "发送验证码"
  - text: 请输入邮箱验证码。
  - status: 验证码已发送，请查收邮件。
  - button "有邀请码？" [expanded]
  - text: 邀请码（选填）
  - textbox "邀请码（选填）": fixture-invite
  - button "注册账号"
  - button "返回登录"
  - button "暂时跳过"
  - paragraph: 模型服务需单独配置，登录账号不代表已配置模型或获得额度。

## Google waiting

- region "完成 Google 登录":
  - heading "完成 Google 登录" [level=1]
  - status: 请在浏览器中完成 Google 登录及漫途客户端授权。完成后返回漫途 Agent。
  - button "重新打开授权页"
  - button "取消登录"
  - button "暂时跳过"
  - paragraph: 模型服务需单独配置，登录账号不代表已配置模型或获得额度。
