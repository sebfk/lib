import { normalizeAmount, normalizeIntegerAmount } from './helpers'

describe('normalizeAmount', () => {
  it('should return a string number rounded to the 16th decimal place', () => {
    const result = normalizeAmount('586084736227728377283728272309128120398')
    expect(result).toEqual('586084736227728400000000000000000000000')
  })
})

describe('normalizeIntegerAmount', () => {
  it('should return a string number rounded to the 16th decimal place', () => {
    const result = normalizeIntegerAmount('586084736227728377283728272309128120398')
    expect(result).toEqual('586084736227728400000000000000000000000')

    const result2 = normalizeIntegerAmount('586084736227728.3')
    expect(result2).toEqual('586084736227728')
  })
})
