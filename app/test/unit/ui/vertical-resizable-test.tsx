import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import { fireEvent, render, screen } from '../../helpers/ui/render'
import {
  DefaultMaxHeight,
  DefaultMinHeight,
  VerticalResizable,
} from '../../../src/ui/resizable/vertical-resizable'

function renderResizable(
  overrides: Partial<React.ComponentProps<typeof VerticalResizable>> = {}
) {
  const resizedHeights: number[] = []
  let resetCount = 0

  const props: React.ComponentProps<typeof VerticalResizable> = {
    height: 200,
    minimumHeight: 120,
    maximumHeight: 300,
    description: 'File history',
    onResize: height => resizedHeights.push(height),
    onReset: () => {
      resetCount++
    },
    children: <div data-testid="resizable-content">History</div>,
    ...overrides,
  }

  const view = render(<VerticalResizable {...props} />)

  return {
    ...view,
    view,
    props,
    resizedHeights,
    getResetCount: () => resetCount,
  }
}

describe('VerticalResizable', () => {
  it('exposes a horizontal separator with the current height and bounds', () => {
    const view = renderResizable({ height: 220 })
    const separator = screen.getByRole('separator', {
      name: 'Resize handle',
    })
    const container = view.container.querySelector(
      '.vertical-resizable-component'
    ) as HTMLElement | null

    assert.notEqual(container, null)
    assert.equal(container?.style.height, '220px')
    assert.equal(separator.getAttribute('aria-orientation'), 'horizontal')
    assert.equal(separator.getAttribute('aria-valuemin'), '120')
    assert.equal(separator.getAttribute('aria-valuemax'), '300')
    assert.equal(separator.getAttribute('aria-valuenow'), '220')
  })

  it('clamps dragged heights and emits reset on double click', () => {
    const { resizedHeights, getResetCount } = renderResizable({
      height: 200,
      minimumHeight: 120,
      maximumHeight: 300,
    })
    const separator = screen.getByRole('separator', {
      name: 'Resize handle',
    })

    fireEvent.mouseDown(separator, { button: 0, clientY: 100 })
    fireEvent.mouseMove(document, { clientY: 1000 })
    fireEvent.mouseMove(document, { clientY: -1000 })
    fireEvent.mouseUp(document)
    fireEvent.doubleClick(separator)

    assert.deepEqual(resizedHeights, [300, 120])
    assert.equal(getResetCount(), 1)
  })

  it('reverses drag and keyboard direction for a top handle', () => {
    const { view, props, resizedHeights } = renderResizable({
      height: 200,
      minimumHeight: 120,
      maximumHeight: 300,
      handlePosition: 'top',
    })
    const separator = screen.getByRole('separator', {
      name: 'Resize handle',
    })

    fireEvent.mouseDown(separator, { button: 0, clientY: 100 })
    fireEvent.mouseMove(document, { clientY: 90 })
    fireEvent.mouseUp(document)

    view.rerender(
      <VerticalResizable {...props} height={210} handlePosition="top" />
    )
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowUp' })

    view.rerender(
      <VerticalResizable {...props} height={215} handlePosition="top" />
    )
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowDown' })

    assert.deepEqual(resizedHeights, [210, 215, 210])
  })

  it('supports keyboard resizing with clamped arrow, home, and end keys', () => {
    const { view, props, resizedHeights } = renderResizable({
      height: 200,
      minimumHeight: 120,
      maximumHeight: 300,
    })

    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowDown' })
    assert.deepEqual(resizedHeights, [205])

    view.rerender(<VerticalResizable {...props} height={205} />)
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowUp' })

    view.rerender(<VerticalResizable {...props} height={200} />)
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'Home' })

    view.rerender(<VerticalResizable {...props} height={120} />)
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'End' })

    assert.deepEqual(resizedHeights, [205, 200, 120, 300])
  })

  it('uses default bounds when callers omit minimum and maximum heights', () => {
    const { resizedHeights } = renderResizable({
      height: DefaultMinHeight,
      minimumHeight: undefined,
      maximumHeight: undefined,
    })
    const separator = screen.getByRole('separator')

    fireEvent.keyDown(separator, { key: 'ArrowUp' })
    fireEvent.keyDown(separator, { key: 'End' })

    assert.deepEqual(resizedHeights, [DefaultMaxHeight])
  })

  it('removes document drag listeners when unmounted during a drag', () => {
    const { view, resizedHeights } = renderResizable()
    const separator = screen.getByRole('separator')

    fireEvent.mouseDown(separator, { button: 0, clientY: 100 })
    view.unmount()
    fireEvent.mouseMove(document, { clientY: 1000 })

    assert.deepEqual(resizedHeights, [])
  })
})
