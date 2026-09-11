## Native account from guide

- dialog "登录漫途账号":
  - button "返回创作"
  - region "登录漫途账号":
    - heading "登录漫途账号" [level=1]
    - paragraph: 在浏览器中登录并授权，完成后自动返回漫途 Agent。
    - button "登录漫途账号"
    - button "暂时跳过"

## endpoint-unavailable

- dialog "登录漫途账号":
  - button "返回创作"
  - region "登录漫途账号":
    - heading "登录漫途账号" [level=1]
    - paragraph: 在浏览器中登录并授权，完成后自动返回漫途 Agent。
    - alert: 当前服务器尚未提供桌面登录接口，请联系发布人完成服务部署。无需修改本地配置文件。
    - button "登录漫途账号"
    - button "暂时跳过"

## protocol

- dialog "登录漫途账号":
  - button "返回创作"
  - region "登录漫途账号":
    - heading "登录漫途账号" [level=1]
    - paragraph: 在浏览器中登录并授权，完成后自动返回漫途 Agent。
    - alert: 登录服务返回了不兼容的数据，请联系发布人核对客户端与服务端版本。
    - button "登录漫途账号"
    - button "重新检查登录状态"
    - button "暂时跳过"

## Guide after Skip

- dialog "剧本改编":
  - heading "剧本改编" [level=2]
  - button "关闭引导":
    - img
  - paragraph: 尚未安装此技能。安装后可添加到当前对话。
  - button "登录后安装"

## Marketplace after login

- dialog "爽文短剧剧本创作":
  - heading "爽文短剧剧本创作" [level=2]
  - button "关闭":
    - img
  - paragraph: 从创意到分集剧本。
  - text: 剧本创作 版本 1.0.0
  - button "安装技能"
