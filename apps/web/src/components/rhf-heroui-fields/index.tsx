import type { FieldPath, FieldValues, UseControllerProps } from 'react-hook-form'
import {
  Checkbox,
  Description,
  FieldError,
  Input,
  Label,
  ListBox,
  NumberField,
  Select,
  Switch,
  TextArea,
  TextField,
} from '@heroui/react'
import { Controller } from 'react-hook-form'

export interface SelectOption {
  label: string
  value: string
}

interface BaseFieldProps<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>
  extends UseControllerProps<TFieldValues, TName> {
  label: string
  description?: React.ReactNode
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function RhfTextField<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>({
  label,
  description,
  placeholder,
  disabled,
  className,
  type,
  ...controllerProps
}: BaseFieldProps<TFieldValues, TName> & { type?: React.HTMLInputTypeAttribute }) {
  return (
    <Controller
      {...controllerProps}
      render={({ field, fieldState }) => (
        <TextField
          className={className ?? 'w-full'}
          isDisabled={disabled}
          isInvalid={fieldState.invalid}
          name={field.name}
          type={type}
          value={field.value ?? ''}
          onBlur={field.onBlur}
          onChange={field.onChange}
        >
          <Label>{label}</Label>
          <Input placeholder={placeholder} variant="secondary" />
          {fieldState.error?.message
            ? <FieldError>{fieldState.error.message}</FieldError>
            : description
              ? <Description>{description}</Description>
              : null}
        </TextField>
      )}
    />
  )
}

export function RhfTextAreaField<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>({
  label,
  description,
  placeholder,
  disabled,
  className,
  rows = 3,
  ...controllerProps
}: BaseFieldProps<TFieldValues, TName> & { rows?: number }) {
  return (
    <Controller
      {...controllerProps}
      render={({ field, fieldState }) => (
        <TextField
          className={className ?? 'w-full'}
          isDisabled={disabled}
          isInvalid={fieldState.invalid}
          name={field.name}
          value={field.value ?? ''}
          onBlur={field.onBlur}
          onChange={field.onChange}
        >
          <Label>{label}</Label>
          <TextArea placeholder={placeholder} rows={rows} variant="secondary" />
          {fieldState.error?.message
            ? <FieldError>{fieldState.error.message}</FieldError>
            : description
              ? <Description>{description}</Description>
              : null}
        </TextField>
      )}
    />
  )
}

export function RhfNumberField<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>({
  label,
  description,
  disabled,
  className,
  minValue,
  maxValue,
  step,
  variant,
  ...controllerProps
}: BaseFieldProps<TFieldValues, TName> & {
  minValue?: number
  maxValue?: number
  step?: number
  variant?: 'secondary' | 'primary'
}) {
  return (
    <Controller
      {...controllerProps}
      render={({ field, fieldState }) => (
        <NumberField
          className={className ?? 'w-full'}
          isDisabled={disabled}
          isInvalid={fieldState.invalid}
          maxValue={maxValue}
          minValue={minValue}
          name={field.name}
          step={step}
          variant={variant}
          value={typeof field.value === 'number' ? field.value : undefined}
          onBlur={field.onBlur}
          onChange={field.onChange}
        >
          <Label>{label}</Label>
          <NumberField.Group>
            <NumberField.DecrementButton />
            <NumberField.Input />
            <NumberField.IncrementButton />
          </NumberField.Group>
          {fieldState.error?.message
            ? <FieldError>{fieldState.error.message}</FieldError>
            : description
              ? <Description>{description}</Description>
              : null}
        </NumberField>
      )}
    />
  )
}

export function RhfSwitchField<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>({
  label,
  disabled,
  className,
  ...controllerProps
}: Omit<BaseFieldProps<TFieldValues, TName>, 'description' | 'placeholder'>) {
  return (
    <Controller
      {...controllerProps}
      render={({ field }) => (
        <Switch
          className={className}
          isDisabled={disabled}
          isSelected={Boolean(field.value)}
          onBlur={field.onBlur}
          onChange={field.onChange}
        >
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          <Switch.Content>
            <Label className="text-sm">{label}</Label>
          </Switch.Content>
        </Switch>
      )}
    />
  )
}

export function RhfCheckboxField<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>({
  label,
  disabled,
  className,
  ...controllerProps
}: Omit<BaseFieldProps<TFieldValues, TName>, 'description' | 'placeholder'>) {
  return (
    <Controller
      {...controllerProps}
      render={({ field }) => (
        <Checkbox
          className={className}
          isDisabled={disabled}
          isSelected={Boolean(field.value)}
          onChange={field.onChange}
        >
          <Checkbox.Control>
            <Checkbox.Indicator />
          </Checkbox.Control>
          <Checkbox.Content>
            <Label>{label}</Label>
          </Checkbox.Content>
        </Checkbox>
      )}
    />
  )
}

export function RhfSelectField<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>({
  label,
  description,
  placeholder,
  disabled,
  className,
  options,
  loading: _loading,
  ...controllerProps
}: BaseFieldProps<TFieldValues, TName> & { options: SelectOption[], loading?: boolean }) {
  return (
    <Controller
      {...controllerProps}
      render={({ field, fieldState }) => (
        <Select
          className={className ?? 'w-full'}
          isDisabled={disabled}
          isInvalid={fieldState.invalid}
          value={field.value ?? null}
          onChange={key => field.onChange(key)}
        >
          <Label>{label}</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox items={options}>
              {option => (
                <ListBox.Item id={option.value} textValue={option.label}>
                  {option.label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              )}
            </ListBox>
          </Select.Popover>
          {fieldState.error?.message
            ? <FieldError>{fieldState.error.message}</FieldError>
            : description
              ? <Description>{description}</Description>
              : null}
        </Select>
      )}
    />
  )
}
