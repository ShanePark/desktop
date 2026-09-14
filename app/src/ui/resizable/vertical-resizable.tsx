/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
import * as React from 'react'

import { clamp } from '../../lib/clamp'
import { AriaLiveContainer } from '../accessibility/aria-live-container'

export const DefaultMaxHeight = 400
export const DefaultMinHeight = 120

export interface IVerticalResizableProps {
  readonly children: React.ReactNode

  /** The current height of the panel in pixels. */
  readonly height: number

  /** The maximum height that can be selected. */
  readonly maximumHeight?: number

  /** The minimum height that can be selected. */
  readonly minimumHeight?: number

  /** An optional ID for the root element. */
  readonly id?: string

  /** Which edge contains the resize handle. Defaults to the bottom edge. */
  readonly handlePosition?: 'top' | 'bottom'

  /** Used to describe the resizable panel to screen reader users. */
  readonly description: string

  /** Called when the panel height changes through a drag. */
  readonly onResize: (newHeight: number) => void

  /** Called when the resize handle is double clicked. */
  readonly onReset: () => void
}

interface IVerticalResizableState {
  readonly resizeMessage: string
}

/**
 * A resizable panel whose handle is placed along either horizontal edge.
 *
 * This intentionally mirrors Resizable's API while keeping the existing
 * horizontal resizable behavior unchanged.
 */
export class VerticalResizable extends React.Component<
  IVerticalResizableProps,
  IVerticalResizableState
> {
  private startHeight: number | null = null
  private startY: number | null = null
  private previousResizeHeight: number | null = null

  public constructor(props: IVerticalResizableProps) {
    super(props)
    this.state = { resizeMessage: '' }
  }

  private getCurrentHeight() {
    return this.clampHeight(this.props.height)
  }

  private clampHeight(height: number) {
    return clamp(
      height,
      this.props.minimumHeight ?? DefaultMinHeight,
      this.props.maximumHeight ?? DefaultMaxHeight
    )
  }

  private get minimumHeight() {
    return this.props.minimumHeight ?? DefaultMinHeight
  }

  private get maximumHeight() {
    return this.props.maximumHeight ?? DefaultMaxHeight
  }

  private get handlePosition() {
    return this.props.handlePosition ?? 'bottom'
  }

  /**
   * The top edge moves in the opposite direction to the panel's height: when
   * the user drags it up, the panel grows. The bottom edge follows the drag.
   */
  private get heightDeltaSign() {
    return this.handlePosition === 'top' ? -1 : 1
  }

  private handleDragStart = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }

    this.startY = event.clientY
    this.startHeight = this.getCurrentHeight()
    this.previousResizeHeight = this.startHeight

    document.addEventListener('mousemove', this.handleDragMove)
    document.addEventListener('mouseup', this.handleDragStop)

    event.preventDefault()
  }

  private handleDragMove = (event: MouseEvent) => {
    if (this.startHeight === null || this.startY === null) {
      return
    }

    const deltaY = event.clientY - this.startY
    const newHeight = this.clampHeight(
      this.startHeight + deltaY * this.heightDeltaSign
    )
    const previousHeight = this.previousResizeHeight ?? this.startHeight
    this.previousResizeHeight = newHeight
    this.updateResizeMessage(newHeight, previousHeight)
    this.props.onResize(newHeight)
    event.preventDefault()
  }

  private handleDragStop = (event: MouseEvent) => {
    document.removeEventListener('mousemove', this.handleDragMove)
    document.removeEventListener('mouseup', this.handleDragStop)
    this.startHeight = null
    this.startY = null
    this.previousResizeHeight = null
    event.preventDefault()
  }

  private updateResizeMessage(height: number, previousHeight: number) {
    const minHeight = this.minimumHeight
    const maxHeight = this.maximumHeight
    const direction =
      height > previousHeight
        ? 'increased'
        : height < previousHeight
        ? 'decreased'
        : 'unchanged'
    const percentage = Math.round(
      maxHeight === minHeight
        ? 100
        : ((height - minHeight) / (maxHeight - minHeight)) * 100
    )

    this.setState({
      resizeMessage: `${this.props.description} height ${direction}. Set to ${height}px (${percentage}%)`,
    })
  }

  private handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const currentHeight = this.getCurrentHeight()
    let newHeight: number | null = null

    if (event.key === 'ArrowUp') {
      newHeight = this.clampHeight(currentHeight - 5 * this.heightDeltaSign)
    } else if (event.key === 'ArrowDown') {
      newHeight = this.clampHeight(currentHeight + 5 * this.heightDeltaSign)
    } else if (event.key === 'Home') {
      newHeight = this.clampHeight(this.minimumHeight)
    } else if (event.key === 'End') {
      newHeight = this.clampHeight(this.maximumHeight)
    }

    if (newHeight === null || newHeight === currentHeight) {
      return
    }

    event.preventDefault()
    this.updateResizeMessage(newHeight, currentHeight)
    this.props.onResize(newHeight)
  }

  public componentWillUnmount() {
    document.removeEventListener('mousemove', this.handleDragMove)
    document.removeEventListener('mouseup', this.handleDragStop)
    this.previousResizeHeight = null
  }

  public render() {
    const style: React.CSSProperties = {
      height: this.getCurrentHeight(),
      maxHeight: this.maximumHeight,
      minHeight: this.minimumHeight,
    }

    return (
      <div
        id={this.props.id}
        className="vertical-resizable-component"
        style={style}
      >
        {this.props.children}
        <div
          tabIndex={0}
          onMouseDown={this.handleDragStart}
          onKeyDown={this.handleKeyDown}
          onDoubleClick={this.props.onReset}
          className={`vertical-resize-handle handle-${this.handlePosition}`}
          aria-label="Resize handle"
          role="separator"
          aria-orientation="horizontal"
          aria-valuemin={this.minimumHeight}
          aria-valuemax={this.maximumHeight}
          aria-valuenow={this.getCurrentHeight()}
        />
        <AriaLiveContainer
          message={this.state.resizeMessage}
          trackedUserInput={this.state.resizeMessage}
        />
      </div>
    )
  }
}
