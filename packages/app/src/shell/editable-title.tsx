import { createEffect, on, onCleanup, type Accessor } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"

/**
 * In-place rename for a session row. The owner decides when an edit starts and what a commit means; this keeps only
 * the mechanics that are easy to get wrong separately: the caret, the select-all, and the click-away that ends it.
 */
export function EditableTitle(props: {
  text: Accessor<string>
  editing: boolean
  root: Accessor<HTMLElement | undefined>
  innerRef?: (element: HTMLSpanElement) => void
  attributes?: Record<string, string | undefined>
  class?: string
  onEditRequest: () => void
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  let titleEl!: HTMLSpanElement

  const selectAll = () => {
    const range = document.createRange()
    range.selectNodeContents(titleEl)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }

  const commit = () => {
    if (!props.editing) return
    titleEl.scrollLeft = 0
    props.onCommit((titleEl.textContent ?? "").trim())
  }

  createEffect(() => {
    if (props.editing) return
    titleEl.textContent = props.text()
  })

  // Only the rising edge seeds the editor. Re-running on a title change would rewrite the text under the caret,
  // which collapses the selection an in-flight rename made and pastes the new value in front of the old one.
  createEffect(
    on(
      () => props.editing,
      (editing, wasEditing) => {
        if (!editing || wasEditing) return
        titleEl.textContent = props.text()

        requestAnimationFrame(() => {
          titleEl.focus()
          selectAll()
        })

        const cleanup = makeEventListener(
          document,
          "pointerdown",
          (event) => {
            const target = event.target

            if (!(target instanceof Node)) return

            if (props.root()?.contains(target)) return
            commit()
          },
          { capture: true },
        )

        onCleanup(cleanup)
      },
    ),
  )

  return (
    <span
      ref={(el) => {
        titleEl = el
        props.innerRef?.(el)
      }}
      dir="auto"
      class="min-w-0 flex-1 outline-none leading-4"
      classList={{
        "overflow-hidden text-clip whitespace-nowrap": !props.editing,
        "select-text": props.editing,
        [props.class ?? ""]: !!props.class,
      }}
      contenteditable={props.editing ? "plaintext-only" : undefined}
      onDblClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        props.onEditRequest()
      }}
      onKeyDown={(event) => {
        event.stopPropagation()

        if (event.key === "Enter") {
          event.preventDefault()
          commit()

          return
        }

        if (event.key !== "Escape") return
        event.preventDefault()
        props.onCancel()
      }}
      onBlur={commit}
      onPointerDown={(event) => {
        if (!props.editing) return
        event.stopPropagation()
      }}
      onClick={(event) => {
        if (!props.editing) return
        event.preventDefault()
      }}
      {...props.attributes}
    />
  )
}
