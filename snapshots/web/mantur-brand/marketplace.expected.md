## Catalog

- main "技能广场":
  - button "返回对话":
    - img
    - text: 返回对话
  - heading "技能广场" [level=1]
  - paragraph: 发现适合漫剧创作的技能，让重复步骤自动完成。
  - text: 已安装 0 个
  - img
  - textbox:
    - /placeholder: 搜索技能名称、用途或触发词
  - button "全部"
  - button "漫剧创作"
  - article:
    - button "故事导演 把完整剧本整理成可执行的漫剧制作方案。":
      - strong: 故事导演
      - text: 把完整剧本整理成可执行的漫剧制作方案。
    - text: 漫剧创作
    - button "查看"

## Detail

- dialog "故事导演":
  - heading "故事导演" [level=2]
  - button "关闭":
    - img
  - paragraph: 把完整剧本整理成可执行的漫剧制作方案。
  - text: 漫剧创作 版本 1.2.3
  - paragraph: 从剧本分析开始，自动组织角色、场景和分镜。
  - button "登录后安装"

## Login gate

- dialog "故事导演":
  - heading "故事导演" [level=2]
  - button "关闭":
    - img
  - paragraph: 把完整剧本整理成可执行的漫剧制作方案。
  - text: 漫剧创作 版本 1.2.3
  - paragraph: 从剧本分析开始，自动组织角色、场景和分镜。
  - text: 在 ManturHub 登录页输入授权码
  - strong: MANTUR-1234
  - link "打开 ManturHub 登录页":
    - /url: {{manturHubUrl}}/verify
  - button "取消登录"
  - button "登录后安装" [disabled]

## Install failure

- dialog "故事导演":
  - heading "故事导演" [level=2]
  - button "关闭":
    - img
  - paragraph: 把完整剧本整理成可执行的漫剧制作方案。
  - text: 漫剧创作 版本 1.2.3
  - paragraph: 从剧本分析开始，自动组织角色、场景和分镜。
  - alert: 技能安装失败，原有文件没有被覆盖。请稍后重试。
  - button "安装技能"

## Recipe catalog

- main "配方广场":
  - button "返回对话":
    - img
    - text: 返回对话
  - heading "配方广场" [level=1]
  - paragraph: 从经过验证的优秀案例出发，替换成你的内容，让漫途复刻同款效果。
  - text: 共 1 份配方
  - img
  - textbox "搜索想复刻的画面、风格或用途"
  - button "全部" [pressed]
  - button "视频"
  - button "图片"
  - button "剧本"
  - paragraph: 配方免费 · 生成按所用算子计费
  - article:
    - button "查看配方：宿命感双人电影海报"
    - button "宿命感双人电影海报"
    - img
    - text: 268 次复刻 约 0.08 元
    - button "复刻同款":
      - text: 复刻同款
      - img

## Recipe detail

- main "宿命感双人电影海报":
  - button "返回配方广场":
    - img
    - text: 返回配方广场
  - img "宿命感双人电影海报"
  - article:
    - text: 图片 电影感 双人海报
    - heading "宿命感双人电影海报" [level=1]
    - paragraph: 替换两位角色与片名，复刻具有电影质感的双人关系海报。
    - text: 由 漫途创作实验室 发布 268 次复刻 约 0.08 元
    - button "交给 Agent 复刻"
    - link "查看来源：ManturHub 精选":
      - /url: {{manturHubUrl}}/recipes/rcp.image.cinematic-poster
  - heading "成片效果" [level=2]
  - paragraph: 低饱和电影光影，两位角色以近远景形成关系张力。
  - heading "你可以替换" [level=2]
  - term: 角色甲
  - definition: 上传人物图
  - term: 角色乙
  - definition: 上传人物图
  - term: 片名
  - definition: 输入文字
  - heading "提示词模板" [level=2]
  - text: "以 {角色甲} 与 {角色乙} 为主角，片名为 {片名}。"
  - heading "模型与算子" [level=2]
  - paragraph: Seedream 4.0 · mantur.image.generate
  - heading "复刻说明" [level=2]
  - paragraph: 请用 ManturHub 复刻这份配方，并在运行前展示实时报价。
