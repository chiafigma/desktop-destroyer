import { until } from "../../../../42/lib/event/on.js"
import { menu } from "../../../../42/ui/layout/menu.js"
import { game } from "./DesktopDestroyer.js"

/** @import { DialogComponent } from "../../../../42/ui/layout/dialog.js" */

/** @type {DialogComponent} */
const dialogEl = window.frameElement?.closest("ui-dialog")

const menuItems = [
  ...game.weapons.map((weapon, idx) => ({
    tag: "checkbox",
    label: weapon.name,
    checked: () => game.weapon.name === weapon.name,
    action: () => {
      if (idx === game.weaponIdx) return
      game.setWeapon(idx)
    },
  })),
  "---",
  {
    label: "About",
    disabled: () => !dialogEl,
    action: () => {
      if (dialogEl) dialogEl.app.about()
    },
  },
  // {
  //   label: "Bookmarklet",
  //   action: async () => {
  //     const { alert } = await import("../../../../42/ui/layout/dialog.js")
  //     alert([
  //       "Drag the following link to your nearest bookmark bar to activate on any site: ",
  //       {
  //         tag: "a",
  //         // eslint-disable-next-line no-script-url
  //         href: "javascript:(function(){console.log(1)}())",
  //         content: "stress.exe",
  //       },
  //     ])
  //   },
  // },
  "---",
  {
    label: "Quit",
    action: () => {
      if (dialogEl) dialogEl.app.destroy()
      else window.close()
    },
  },
]

document.addEventListener(
  "contextmenu", //
  async (e) => {
    game.pause()
    const menuEl = await menu(menuItems, { of: e })
    await until(menuEl, "ui:menu.close")
    game.play()
  },
)
